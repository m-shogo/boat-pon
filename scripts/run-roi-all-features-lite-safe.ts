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
const auditPath = fileURLToPath(new URL("./assert-roi-all-feature-settlement-integrity.ts", import.meta.url));
const analyzerPath = fileURLToPath(new URL("./search-roi-all-features-lite.ts", import.meta.url));
const OUTPUTS = [
  { staged: "reports/roi-all-feature-search.md", destination: "reports/roi-all-feature-search.md", code: "MD" },
  { staged: "reports/roi-all-feature-search.json", destination: "reports/roi-all-feature-search.json", code: "JSON" },
  { staged: "reports/roi-all-feature-search.csv", destination: "reports/roi-all-feature-search.csv", code: "CSV" },
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
      `ROI_ALL_FEATURE_${code}_PUBLISH_TEMP_IDENTITY_INVALID`,
    );
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(
        path,
        `ROI_ALL_FEATURE_${code}_PUBLISH_DESTINATION_IDENTITY_INVALID`,
      );
    }
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

const auditedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ROI_ALL_FEATURE_PREFLIGHT_DB_IDENTITY_INVALID",
);
run(auditPath, { env: { ...process.env, BOAT_PON_DB_PATH: auditedDbPath } });

// The settlement gate and analyzer remain separate read-only processes. Reverify
// the database immediately before the analyzer launch so a path swap cannot
// bypass the preflight, and keep raw report writes outside canonical reports/.
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ROI_ALL_FEATURE_ANALYZER_DB_IDENTITY_INVALID",
);
const workspace = mkdtempSync(join(tmpdir(), "boat-pon-roi-all-feature-"));
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
      `ROI_ALL_FEATURE_${output.code}_STAGED_OUTPUT_IDENTITY_INVALID`,
    );
    atomicPublish(output.destination, readFileSync(verifiedStagedPath, "utf8"), output.code);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
