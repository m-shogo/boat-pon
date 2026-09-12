/**
 * report-exacta-forward-monitor.ts — guarded research-only entrypoint
 *
 * The internal monitor consumes historical_alternative_odds; it intentionally
 * does not consume odds_timeseries_snapshots. Before any forward ROI/readiness
 * report is generated, validate the locked decision cohort and official exacta
 * settlement return states. No production behavior is changed.
 */
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

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const CANDIDATES_PATH = "data/exacta-forward-candidates.json";
const OUT_MD = "reports/exacta-forward-monitor.md";
const OUT_JSON = "reports/exacta-forward-monitor.json";
const internalPath = fileURLToPath(new URL("./report-exacta-forward-monitor-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function run(script: string, env = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    console.error(`[exacta-forward-monitor] failed to start guarded research step: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function atomicPublish(path: string, content: string, errorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, errorCode);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

const preflight = run("scripts/audit-exacta-forward-monitor-settlements.ts");
if (preflight !== 0) {
  console.error("[exacta-forward-monitor] FAIL CLOSED: cohort/settlement preflight did not pass; forward metrics were not generated");
  process.exit(preflight);
}

if (!existsSync(DB_PATH)) throw new Error("EXACTA_FORWARD_MONITOR_DB_MISSING");
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "EXACTA_FORWARD_MONITOR_DB_HANDOFF_IDENTITY_INVALID",
);
if (!existsSync(CANDIDATES_PATH)) throw new Error("EXACTA_FORWARD_MONITOR_CANDIDATES_MISSING");
const verifiedCandidatesPath = assertCanonicalSingleLinkRegularFile(
  CANDIDATES_PATH,
  "EXACTA_FORWARD_MONITOR_CANDIDATE_IDENTITY_INVALID",
);
const childDbPath = assertCanonicalSingleLinkRegularFile(
  handoffDbPath,
  "EXACTA_FORWARD_MONITOR_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);
const handoffCandidatesSourcePath = assertCanonicalSingleLinkRegularFile(
  verifiedCandidatesPath,
  "EXACTA_FORWARD_MONITOR_CANDIDATE_SOURCE_HANDOFF_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-exacta-forward-monitor-"));
try {
  const workspaceCandidates = join(workspace, CANDIDATES_PATH);
  mkdirSync(join(workspace, "data"), { recursive: true });
  mkdirSync(join(workspace, "reports"), { recursive: true });
  copyFileSync(handoffCandidatesSourcePath, workspaceCandidates);
  assertCanonicalSingleLinkRegularFile(
    workspaceCandidates,
    "EXACTA_FORWARD_MONITOR_STAGED_CANDIDATE_IDENTITY_INVALID",
  );

  const childDbHandoffPath = assertCanonicalSingleLinkRegularFile(
    childDbPath,
    "EXACTA_FORWARD_MONITOR_DB_ISOLATED_CHILD_HANDOFF_IDENTITY_INVALID",
  );
  const loader = `await import(${JSON.stringify(pathToFileURL(internalPath).href)})`;
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    childDbHandoffPath,
    "EXACTA_FORWARD_MONITOR_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  assertCanonicalSingleLinkRegularFile(
    workspaceCandidates,
    "EXACTA_FORWARD_MONITOR_CANDIDATE_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const monitor = spawnSync(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "--eval", loader],
    {
      cwd: workspace,
      env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (monitor.error || monitor.status !== 0) {
    throw new Error("EXACTA_FORWARD_MONITOR_INTERNAL_FAILED");
  }

  const workspaceMd = join(workspace, OUT_MD);
  const workspaceJson = join(workspace, OUT_JSON);
  if (!existsSync(workspaceMd)) throw new Error("EXACTA_FORWARD_MONITOR_MD_OUTPUT_MISSING");
  if (!existsSync(workspaceJson)) throw new Error("EXACTA_FORWARD_MONITOR_JSON_OUTPUT_MISSING");
  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    workspaceMd,
    "EXACTA_FORWARD_MONITOR_MD_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "EXACTA_FORWARD_MONITOR_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(verifiedMdPath, "utf8")
    .split(launchDbPath)
    .join("verified read-only research DB");
  const json = readFileSync(verifiedJsonPath, "utf8")
    .split(launchDbPath)
    .join("verified read-only research DB");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_MD,
    markdown,
    "EXACTA_FORWARD_MONITOR_MD_PUBLISH_TEMP_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "EXACTA_FORWARD_MONITOR_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
