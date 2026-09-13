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
import { fileURLToPath } from "node:url";

import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const auditPath = fileURLToPath(new URL("./audit-all-bet-type-screening-payout-completeness.ts", import.meta.url));
const analyzerPath = fileURLToPath(new URL("./analyze-all-bet-type-screening.ts", import.meta.url));
const OUTPUTS = [
  { staged: "reports/all-bet-type-screening.md", destination: "reports/all-bet-type-screening.md", code: "MD" },
  { staged: "reports/all-bet-type-screening.json", destination: "reports/all-bet-type-screening.json", code: "JSON" },
] as const;

function run(script: string, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    cwd: options.cwd,
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function assertCanonicalDirectory(path: string, code: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(code);
  const resolvedPath = resolve(path);
  if (realpathSync(path) !== resolvedPath) throw new Error(code);
  return resolvedPath;
}

function verifyExistingDestinations(): void {
  for (const output of OUTPUTS) {
    if (!existsSync(output.destination)) continue;
    assertCanonicalSingleLinkRegularFile(
      output.destination,
      `ALL_BET_TYPE_SCREENING_${output.code}_PREPUBLISH_DESTINATION_IDENTITY_INVALID`,
    );
  }
}

function atomicPublish(path: string, content: string, code: string): void {
  const parentPath = dirname(path);
  assertCanonicalDirectory(
    parentPath,
    `ALL_BET_TYPE_SCREENING_${code}_PUBLISH_PARENT_IDENTITY_INVALID`,
  );
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(
      tempPath,
      `ALL_BET_TYPE_SCREENING_${code}_PUBLISH_TEMP_IDENTITY_INVALID`,
    );
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(
        path,
        `ALL_BET_TYPE_SCREENING_${code}_PUBLISH_DESTINATION_IDENTITY_INVALID`,
      );
    }
    assertCanonicalDirectory(
      parentPath,
      `ALL_BET_TYPE_SCREENING_${code}_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID`,
    );
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

run(auditPath);

// The audit and analyzer remain separate read-only processes. Reverify the DB
// before preparing the analyzer handoff, and again immediately before launch,
// so a path swap cannot bypass the payout audit or the research DB boundary.
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const workspace = mkdtempSync(join(tmpdir(), "boat-pon-all-bet-screening-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const childDbPath = assertCanonicalSingleLinkRegularFile(
    verifiedDbPath,
    "ALL_BET_TYPE_SCREENING_DB_CHILD_HANDOFF_IDENTITY_INVALID",
  );
  run(analyzerPath, {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: childDbPath },
  });

  // Validate every staged artifact before canonical publication begins. This
  // prevents a malformed second artifact from leaving only the first report
  // updated. Revalidate each staged path immediately before its read as well.
  const stagedOutputs = OUTPUTS.map((output) => {
    const stagedPath = join(workspace, output.staged);
    const verifiedStagedPath = assertCanonicalSingleLinkRegularFile(
      stagedPath,
      `ALL_BET_TYPE_SCREENING_${output.code}_STAGED_OUTPUT_IDENTITY_INVALID`,
    );
    return { output, verifiedStagedPath };
  });
  const preparedOutputs = stagedOutputs.map(({ output, verifiedStagedPath }) => {
    const readPath = assertCanonicalSingleLinkRegularFile(
      verifiedStagedPath,
      `ALL_BET_TYPE_SCREENING_${output.code}_STAGED_READ_IDENTITY_INVALID`,
    );
    const content = readFileSync(readPath, "utf8");
    assertCanonicalSingleLinkRegularFile(
      readPath,
      `ALL_BET_TYPE_SCREENING_${output.code}_STAGED_HANDOFF_IDENTITY_INVALID`,
    );
    return { output, content };
  });

  // Preflight the entire destination set before the first replacement. If a
  // sibling destination is non-canonical, neither paired report may change.
  mkdirSync("reports", { recursive: true });
  assertCanonicalDirectory("reports", "ALL_BET_TYPE_SCREENING_REPORTS_DIRECTORY_IDENTITY_INVALID");
  verifyExistingDestinations();
  for (const { output, content } of preparedOutputs) {
    atomicPublish(output.destination, content, output.code);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
