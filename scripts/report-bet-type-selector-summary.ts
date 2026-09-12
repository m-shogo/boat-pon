import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const REQUIRED_REPORTS = [
  "reports/bet-type-coverage-audit.json",
  "reports/all-bet-type-screening.json",
  "reports/promising-bet-type-strategies.json",
  "reports/miss-to-bet-type-recovery.json",
  "reports/bet-type-course-edge.json",
  "reports/bet-type-risk-factors.json",
] as const;
const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/bet-type-selector-summary.md";
const OUT_JSON = "reports/bet-type-selector-summary.json";
const OPAQUE_DB_SOURCE = "primary research database";
const internalPath = fileURLToPath(new URL("./report-bet-type-selector-summary-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

type ReportEnvelope = {
  safety?: {
    pointInTimeSafe?: unknown;
  };
};

function fail(path: string, reason: string): never {
  console.error(`BET_TYPE_SELECTOR_INPUT_REPORT_INVALID ${JSON.stringify({ path, reason })}`);
  process.exit(2);
}

function verifyRequiredReports(): void {
  for (const path of REQUIRED_REPORTS) {
    if (!existsSync(path)) fail(path, "missing");
    const verifiedPath = assertCanonicalSingleLinkRegularFile(
      path,
      "BET_TYPE_SELECTOR_INPUT_REPORT_IDENTITY_INVALID",
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(verifiedPath, "utf8"));
    } catch {
      fail(path, "invalid_json");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(path, "invalid_shape");
    }

    const envelope = parsed as ReportEnvelope;
    if (envelope.safety?.pointInTimeSafe === false) {
      fail(path, "point_in_time_unsafe");
    }
  }
}

function verifyDbHandoff(): string {
  if (!existsSync(DB_PATH)) {
    console.error("BET_TYPE_SELECTOR_DB_MISSING");
    process.exit(2);
  }
  return assertCanonicalSingleLinkRegularFile(DB_PATH, "BET_TYPE_SELECTOR_DB_HANDOFF_IDENTITY_INVALID");
}

function verifyExistingOutputPaths(): void {
  if (existsSync(OUT_MD)) {
    assertCanonicalSingleLinkRegularFile(
      OUT_MD,
      "BET_TYPE_SELECTOR_PREEXISTING_REPORT_IDENTITY_INVALID",
    );
  }
  if (existsSync(OUT_JSON)) {
    assertCanonicalSingleLinkRegularFile(
      OUT_JSON,
      "BET_TYPE_SELECTOR_PREEXISTING_JSON_REPORT_IDENTITY_INVALID",
    );
  }
}

function atomicPublish(
  path: string,
  content: string,
  tempErrorCode: string,
  destinationErrorCode: string,
): void {
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

function stageRequiredReports(workspace: string): void {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  for (const path of REQUIRED_REPORTS) {
    const sourcePath = assertCanonicalSingleLinkRegularFile(
      path,
      "BET_TYPE_SELECTOR_INPUT_REPORT_HANDOFF_IDENTITY_INVALID",
    );
    const stagedPath = join(workspace, path);
    copyFileSync(sourcePath, stagedPath);
    assertCanonicalSingleLinkRegularFile(
      stagedPath,
      "BET_TYPE_SELECTOR_STAGED_INPUT_REPORT_IDENTITY_INVALID",
    );
  }
}

function runIsolated(workspace: string, verifiedDbPath: string): number {
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    verifiedDbPath,
    "BET_TYPE_SELECTOR_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const loader = `await import(${JSON.stringify(pathToFileURL(internalPath).href)})`;
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
    throw new Error("BET_TYPE_SELECTOR_INTERNAL_SPAWN_FAILED");
  }
  const status = result.status ?? 1;
  if (status !== 0) {
    console.error("BET_TYPE_SELECTOR_INTERNAL_FAILED");
    return status;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  return status;
}

function readIsolatedOutputs(workspace: string, dbPath: string): { markdown: string; json: string } {
  const workspaceMd = join(workspace, OUT_MD);
  const workspaceJson = join(workspace, OUT_JSON);
  if (!existsSync(workspaceMd)) {
    throw new Error("BET_TYPE_SELECTOR_REPORT_MISSING_AFTER_ANALYSIS");
  }
  if (!existsSync(workspaceJson)) {
    throw new Error("BET_TYPE_SELECTOR_JSON_REPORT_MISSING_AFTER_ANALYSIS");
  }
  const verifiedReportPath = assertCanonicalSingleLinkRegularFile(
    workspaceMd,
    "BET_TYPE_SELECTOR_REPORT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "BET_TYPE_SELECTOR_JSON_REPORT_IDENTITY_INVALID",
  );
  const report = readFileSync(verifiedReportPath, "utf8");
  const json = readFileSync(verifiedJsonPath, "utf8");
  const provenance = `DB: ${dbPath}`;
  if (!report.includes(provenance)) {
    throw new Error("BET_TYPE_SELECTOR_DB_PROVENANCE_NOT_FOUND");
  }
  try {
    JSON.parse(json);
  } catch {
    throw new Error("BET_TYPE_SELECTOR_JSON_REPORT_INVALID");
  }
  assertCanonicalSingleLinkRegularFile(
    verifiedReportPath,
    "BET_TYPE_SELECTOR_REPORT_HANDOFF_IDENTITY_INVALID",
  );
  assertCanonicalSingleLinkRegularFile(
    verifiedJsonPath,
    "BET_TYPE_SELECTOR_JSON_REPORT_HANDOFF_IDENTITY_INVALID",
  );
  return {
    markdown: report.replaceAll(provenance, `DB: ${OPAQUE_DB_SOURCE}`),
    json,
  };
}

verifyRequiredReports();
verifyExistingOutputPaths();
verifyRequiredReports();
const verifiedDbPath = verifyDbHandoff();
const workspace = mkdtempSync(join(tmpdir(), "boat-pon-bet-type-selector-"));
let status = 1;
try {
  stageRequiredReports(workspace);
  status = runIsolated(workspace, verifiedDbPath);
  if (status === 0) {
    const outputs = readIsolatedOutputs(workspace, verifiedDbPath);
    mkdirSync("reports", { recursive: true });
    atomicPublish(
      OUT_MD,
      outputs.markdown,
      "BET_TYPE_SELECTOR_MD_PUBLISH_TEMP_IDENTITY_INVALID",
      "BET_TYPE_SELECTOR_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
    );
    atomicPublish(
      OUT_JSON,
      outputs.json,
      "BET_TYPE_SELECTOR_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
      "BET_TYPE_SELECTOR_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
    );
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
process.exit(status);
