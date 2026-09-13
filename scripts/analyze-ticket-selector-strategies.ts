/**
 * analyze-ticket-selector-strategies.ts — research-only fail-closed entrypoint
 *
 * The selector ranks multiple bet types by payout ROI. Direct invocation must
 * first prove that every compared payout market is complete for the exact base
 * research population so missing settlements cannot become zero-return races.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const OUT_MD = "reports/ticket-selector-strategies.md";
const OUT_JSON = "reports/ticket-selector-strategies.json";
const OPAQUE_DB_SOURCE = "primary research database";
const corePath = fileURLToPath(new URL("./analyze-ticket-selector-strategies-core.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function run(script: string, env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    console.error(`[ticket-selector] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function assertCanonicalDirectory(path: string, code: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(code);
  const resolvedPath = resolve(path);
  if (realpathSync(path) !== resolvedPath) throw new Error(code);
  return resolvedPath;
}

function verifyExistingOutputPaths(): void {
  if (existsSync(OUT_MD)) {
    assertCanonicalSingleLinkRegularFile(
      OUT_MD,
      "TICKET_SELECTOR_PREEXISTING_REPORT_IDENTITY_INVALID",
    );
  }
  if (existsSync(OUT_JSON)) {
    assertCanonicalSingleLinkRegularFile(
      OUT_JSON,
      "TICKET_SELECTOR_PREEXISTING_JSON_REPORT_IDENTITY_INVALID",
    );
  }
}

function publishAtomically(
  targetPath: string,
  content: string,
  tempErrorCode: string,
  destinationErrorCode: string,
): void {
  const parentPath = dirname(targetPath);
  assertCanonicalDirectory(parentPath, "TICKET_SELECTOR_PUBLISH_PARENT_IDENTITY_INVALID");
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode);
    if (existsSync(targetPath)) {
      assertCanonicalSingleLinkRegularFile(targetPath, destinationErrorCode);
    }
    assertCanonicalDirectory(parentPath, "TICKET_SELECTOR_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
    renameSync(verifiedTempPath, targetPath);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

function runIsolated(workspace: string, verifiedDbPath: string): number {
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    verifiedDbPath,
    "TICKET_SELECTOR_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const loader = `await import(${JSON.stringify(pathToFileURL(corePath).href)})`;
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "--eval", loader],
    {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    },
  );

  if (result.error) {
    throw new Error("TICKET_SELECTOR_INTERNAL_SPAWN_FAILED");
  }
  const status = result.status ?? 1;
  if (status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    console.error("[ticket-selector] analysis failed after successful payout completeness preflight");
    return status;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  return status;
}

function readIsolatedOutputs(workspace: string, dbPath: string): { markdown: string; json: string } {
  const stagedMdPath = join(workspace, OUT_MD);
  const stagedJsonPath = join(workspace, OUT_JSON);
  if (!existsSync(stagedMdPath)) {
    throw new Error("TICKET_SELECTOR_REPORT_MISSING_AFTER_ANALYSIS");
  }
  if (!existsSync(stagedJsonPath)) {
    throw new Error("TICKET_SELECTOR_JSON_REPORT_MISSING_AFTER_ANALYSIS");
  }

  const verifiedReportPath = assertCanonicalSingleLinkRegularFile(
    stagedMdPath,
    "TICKET_SELECTOR_REPORT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    stagedJsonPath,
    "TICKET_SELECTOR_JSON_REPORT_IDENTITY_INVALID",
  );
  const report = readFileSync(verifiedReportPath, "utf8");
  const json = readFileSync(verifiedJsonPath, "utf8");
  const provenance = `DB: ${dbPath}`;
  if (!report.includes(provenance)) {
    throw new Error("TICKET_SELECTOR_DB_PROVENANCE_NOT_FOUND");
  }
  const redacted = report.replaceAll(provenance, `DB: ${OPAQUE_DB_SOURCE}`);
  if (redacted.includes(dbPath) || json.includes(dbPath)) {
    throw new Error("TICKET_SELECTOR_PRIVATE_DB_PATH_REMAINS");
  }
  try {
    JSON.parse(json);
  } catch {
    throw new Error("TICKET_SELECTOR_JSON_REPORT_INVALID");
  }
  assertCanonicalSingleLinkRegularFile(
    verifiedReportPath,
    "TICKET_SELECTOR_REPORT_HANDOFF_IDENTITY_INVALID",
  );
  assertCanonicalSingleLinkRegularFile(
    verifiedJsonPath,
    "TICKET_SELECTOR_JSON_REPORT_HANDOFF_IDENTITY_INVALID",
  );
  return { markdown: redacted, json };
}

const preflight = run("scripts/audit-ticket-selector-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[ticket-selector] FAIL CLOSED: compared-market payout coverage is incomplete; ROI/best-strategy analysis was not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "TICKET_SELECTOR_PRIMARY_DB_IDENTITY_INVALID",
);

verifyExistingOutputPaths();

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-ticket-selector-"));
let status = 1;
try {
  status = runIsolated(workspace, verifiedDbPath);
  if (status === 0) {
    const outputs = readIsolatedOutputs(workspace, verifiedDbPath);
    mkdirSync("reports", { recursive: true });
    assertCanonicalDirectory("reports", "TICKET_SELECTOR_REPORTS_DIRECTORY_IDENTITY_INVALID");
    verifyExistingOutputPaths();
    publishAtomically(
      OUT_MD,
      outputs.markdown,
      "TICKET_SELECTOR_MD_PUBLISH_TEMP_IDENTITY_INVALID",
      "TICKET_SELECTOR_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
    );
    publishAtomically(
      OUT_JSON,
      outputs.json,
      "TICKET_SELECTOR_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
      "TICKET_SELECTOR_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
    );
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (status === 0) {
  console.log("[ticket-selector] PASS: payout completeness preflight passed before selector analysis");
}
process.exit(status);
