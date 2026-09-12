/**
 * report-research-governor.ts — guarded research-only entrypoint
 *
 * Readiness counts may drive the next research action, so they must not be
 * generated from a drifted BUY cohort or from non-canonical/incomplete
 * historical trifecta markets. The preflight is read-only and fail-closed.
 */
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const HYPOTHESIS_PATH = "data/research-hypotheses.json";
const OUT_MD = "reports/research-governor.md";
const OUT_JSON = "reports/research-governor.json";
const REPORT_INPUT_PATHS = [
  "reports/roi-governor.json",
  "reports/historical-alternative-odds-quality.json",
  "reports/condb-switch-historical-closing-odds.json",
  "reports/skip6r-switch-historical-closing-odds.json",
  "reports/skipvenue-switch-historical-closing-odds.json",
  "reports/alternative-odds-timeseries-health.json",
  "reports/roi-skip-policy-simulation.json",
  "reports/paper-forward-monitor.json",
  "reports/paper-forward-candidates.json",
] as const;
const internalPath = fileURLToPath(new URL("./report-research-governor-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function run(script: string, env = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    console.error(`[research-governor] failed to start guarded research step: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function writeExclusive(path: string, content: string | Buffer, errorCode: string): void {
  mkdirSync(dirname(path), { recursive: true });
  let fd: number | null = null;
  try {
    fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    assertCanonicalSingleLinkRegularFile(path, errorCode);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function stageVerifiedInput(sourcePath: string, workspace: string, errorCode: string): void {
  const verifiedSource = assertCanonicalSingleLinkRegularFile(sourcePath, errorCode);
  const destination = join(workspace, sourcePath);
  writeExclusive(
    destination,
    readFileSync(verifiedSource),
    "RESEARCH_GOVERNOR_STAGED_INPUT_IDENTITY_INVALID",
  );
}

function atomicPublish(path: string, content: string, tempErrorCode: string, destinationErrorCode: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode);
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(path, destinationErrorCode);
    }
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

const preflight = run("scripts/audit-research-governor-readiness.ts");
if (preflight !== 0) {
  console.error("[research-governor] FAIL CLOSED: readiness preflight did not pass; no next-action/readiness report was generated");
  process.exit(preflight);
}

if (!existsSync(DB_PATH)) throw new Error("RESEARCH_GOVERNOR_DB_MISSING");
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "RESEARCH_GOVERNOR_DB_HANDOFF_IDENTITY_INVALID",
);

if (!existsSync(HYPOTHESIS_PATH)) throw new Error("RESEARCH_GOVERNOR_HYPOTHESIS_REGISTRY_MISSING");
assertCanonicalSingleLinkRegularFile(
  HYPOTHESIS_PATH,
  "RESEARCH_GOVERNOR_HYPOTHESIS_REGISTRY_IDENTITY_INVALID",
);

for (const reportPath of REPORT_INPUT_PATHS) {
  if (!existsSync(reportPath)) continue;
  assertCanonicalSingleLinkRegularFile(
    reportPath,
    "RESEARCH_GOVERNOR_REPORT_INPUT_IDENTITY_INVALID",
  );
}

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-research-governor-"));
try {
  stageVerifiedInput(
    HYPOTHESIS_PATH,
    workspace,
    "RESEARCH_GOVERNOR_HYPOTHESIS_REGISTRY_STAGE_IDENTITY_INVALID",
  );
  for (const reportPath of REPORT_INPUT_PATHS) {
    if (!existsSync(reportPath)) continue;
    stageVerifiedInput(
      reportPath,
      workspace,
      "RESEARCH_GOVERNOR_REPORT_INPUT_STAGE_IDENTITY_INVALID",
    );
  }
  mkdirSync(join(workspace, "reports"), { recursive: true });

  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    handoffDbPath,
    "RESEARCH_GOVERNOR_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const report = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (report.error || report.status !== 0) {
    throw new Error("RESEARCH_GOVERNOR_INTERNAL_FAILED");
  }

  const workspaceMd = join(workspace, OUT_MD);
  const workspaceJson = join(workspace, OUT_JSON);
  if (!existsSync(workspaceMd)) throw new Error("RESEARCH_GOVERNOR_MD_OUTPUT_MISSING");
  if (!existsSync(workspaceJson)) throw new Error("RESEARCH_GOVERNOR_JSON_OUTPUT_MISSING");
  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    workspaceMd,
    "RESEARCH_GOVERNOR_MD_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "RESEARCH_GOVERNOR_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(verifiedMdPath, "utf8")
    .split(launchDbPath)
    .join("verified read-only research DB");
  const json = readFileSync(verifiedJsonPath, "utf8")
    .split(launchDbPath)
    .join("verified read-only research DB");

  atomicPublish(
    OUT_MD,
    markdown,
    "RESEARCH_GOVERNOR_MD_PUBLISH_TEMP_IDENTITY_INVALID",
    "RESEARCH_GOVERNOR_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "RESEARCH_GOVERNOR_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "RESEARCH_GOVERNOR_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[research-governor] PASS: readiness and input identities verified before isolated report publication");
