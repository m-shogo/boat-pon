import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  N2TrifectaOddsCaptureApproval,
  N2TrifectaOddsCheckpointPlan,
} from "../src/research-replay/n2TrifectaOddsCheckpointCollection";
import { executeN2TrifectaPrivateCapture } from "../src/research-replay/n2TrifectaPrivateCaptureExecutor";
import { assertN2TrifectaPrivateCaptureReportOutputSafe } from "../src/research-replay/n2TrifectaPrivateCaptureReportOutput";

const MAX_JSON_BYTES = 2_000_000;
const repoRoot = resolve(process.cwd());
const rootDir = resolve(argument("root") ?? repoRoot);
const planPath = resolve(requiredArgument("plan"));
const approvalArg = argument("approval");
const approvalPath = approvalArg ? resolve(approvalArg) : null;
const executionMode = process.argv.includes("--execute") ? "execute" : "dry-run";
const now = argument("now") ?? new Date().toISOString();
const reportArg = argument("report");
const reportPath = reportArg ? resolve(reportArg) : null;

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function readJsonFile<T>(
  path: string,
  label: string,
  options: { privateAuthority?: boolean } = {},
): T {
  if (!existsSync(path)) throw new Error(`${label}_NOT_FOUND`);
  if (lstatSync(path).isSymbolicLink()) throw new Error(`${label}_SYMLINK_NOT_ALLOWED`);
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`${label}_NOT_REGULAR_FILE`);
  if (options.privateAuthority && stat.nlink !== 1) throw new Error(`${label}_HARDLINK_NOT_ALLOWED`);
  if (options.privateAuthority && (stat.mode & 0o777) !== 0o600) throw new Error(`${label}_MODE_INVALID`);
  if (stat.size <= 0 || stat.size > MAX_JSON_BYTES) throw new Error(`${label}_SIZE_INVALID`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${label}_INVALID_JSON`);
  }
  return parsed as T;
}

function writeExclusive(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
  } finally {
    closeSync(fd);
  }
}

if (reportPath) {
  assertN2TrifectaPrivateCaptureReportOutputSafe({ repoRoot, captureRoot: rootDir, reportPath });
}

const plan = readJsonFile<N2TrifectaOddsCheckpointPlan>(planPath, "PLAN");
const approval = approvalPath
  ? readJsonFile<N2TrifectaOddsCaptureApproval>(approvalPath, "APPROVAL", { privateAuthority: true })
  : null;

if (executionMode === "execute" && approval === null) {
  throw new Error("--execute requires --approval");
}

const report = await executeN2TrifectaPrivateCapture({
  plan,
  approval,
  rootDir,
  now,
  executionMode,
});

const output = `${JSON.stringify(report, null, 2)}\n`;
console.log(output.trimEnd());

if (reportPath) {
  writeExclusive(reportPath, output);
}

if (report.status === "BLOCKED") process.exitCode = 3;
