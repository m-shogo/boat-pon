import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function atomicPublish(path: string, content: string, code: string): void {
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
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

run(auditPath);

// The audit and analyzer remain separate read-only processes. Reverify the DB
// immediately before the analyzer launch so a path swap cannot bypass the audit.
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const workspace = mkdtempSync(join(tmpdir(), "boat-pon-all-bet-screening-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  run(analyzerPath, {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: verifiedDbPath },
  });

  mkdirSync("reports", { recursive: true });
  for (const output of OUTPUTS) {
    const stagedPath = join(workspace, output.staged);
    const verifiedStagedPath = assertCanonicalSingleLinkRegularFile(
      stagedPath,
      `ALL_BET_TYPE_SCREENING_${output.code}_STAGED_OUTPUT_IDENTITY_INVALID`,
    );
    atomicPublish(output.destination, readFileSync(verifiedStagedPath, "utf8"), output.code);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
