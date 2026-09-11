/**
 * check-alternative-odds-timeseries-health.ts — research-only fail-closed entrypoint
 *
 * Alternative-odds timeseries coverage/readiness metrics may be generated only
 * after the historical BUY overlap population is verified as canonical settled
 * trifecta data. This launcher itself emits no private odds/readiness counts.
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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/alternative-odds-timeseries-health.md";
const OUT_JSON = "reports/alternative-odds-timeseries-health.json";
const internalPath = fileURLToPath(new URL("./check-alternative-odds-timeseries-health-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function run(script: string, env = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    console.error(`[alternative-odds-health] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function assertExistingOutputIdentity(path: string, code: string): void {
  if (!existsSync(path)) return;
  assertCanonicalSingleLinkRegularFile(path, code);
}

function assertGeneratedOutputIdentity(path: string, missingCode: string, invalidCode: string): string {
  if (!existsSync(path)) throw new Error(missingCode);
  return assertCanonicalSingleLinkRegularFile(path, invalidCode);
}

function atomicPublish(path: string, contents: string, errorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, contents, "utf8");
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

const preflight = run("scripts/audit-alternative-odds-timeseries-health-cohort.ts");
if (preflight !== 0) {
  console.error("[alternative-odds-health] FAIL CLOSED: canonical forward cohort preflight did not pass; coverage/readiness output was not generated");
  process.exit(preflight);
}

if (!existsSync(DB_PATH)) throw new Error("ALTERNATIVE_ODDS_HEALTH_DB_MISSING");
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ALTERNATIVE_ODDS_HEALTH_DB_HANDOFF_IDENTITY_INVALID",
);

assertExistingOutputIdentity(OUT_MD, "ALTERNATIVE_ODDS_HEALTH_MD_PREEXISTING_IDENTITY_INVALID");
assertExistingOutputIdentity(OUT_JSON, "ALTERNATIVE_ODDS_HEALTH_JSON_PREEXISTING_IDENTITY_INVALID");

const childDbPath = assertCanonicalSingleLinkRegularFile(
  handoffDbPath,
  "ALTERNATIVE_ODDS_HEALTH_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-alternative-odds-health-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    childDbPath,
    "ALTERNATIVE_ODDS_HEALTH_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const health = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (health.error || health.status !== 0) {
    throw new Error("ALTERNATIVE_ODDS_HEALTH_INTERNAL_FAILED");
  }

  const workspaceMd = assertGeneratedOutputIdentity(
    join(workspace, OUT_MD),
    "ALTERNATIVE_ODDS_HEALTH_MD_WORKSPACE_OUTPUT_MISSING",
    "ALTERNATIVE_ODDS_HEALTH_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID",
  );
  const workspaceJson = assertGeneratedOutputIdentity(
    join(workspace, OUT_JSON),
    "ALTERNATIVE_ODDS_HEALTH_JSON_WORKSPACE_OUTPUT_MISSING",
    "ALTERNATIVE_ODDS_HEALTH_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(workspaceMd, "utf8");
  const json = readFileSync(workspaceJson, "utf8");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_MD,
    markdown,
    "ALTERNATIVE_ODDS_HEALTH_MD_PUBLISH_TEMP_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "ALTERNATIVE_ODDS_HEALTH_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
  );

  assertGeneratedOutputIdentity(
    OUT_MD,
    "ALTERNATIVE_ODDS_HEALTH_MD_OUTPUT_MISSING",
    "ALTERNATIVE_ODDS_HEALTH_MD_OUTPUT_IDENTITY_INVALID",
  );
  assertGeneratedOutputIdentity(
    OUT_JSON,
    "ALTERNATIVE_ODDS_HEALTH_JSON_OUTPUT_MISSING",
    "ALTERNATIVE_ODDS_HEALTH_JSON_OUTPUT_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[alternative-odds-health] PASS: cohort preflight passed before health report generation");