/**
 * audit-alternative-odds-coverage.ts — research-only fail-closed entrypoint
 *
 * Historical alternative-odds coverage counts are emitted only after verifying
 * that the exact forward BUY population is canonical settled trifecta data.
 * No DB writes, app_settings changes, production decisions, notifications,
 * external access, or betting are performed by this launcher.
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
const OUT_MD = "reports/alternative-odds-coverage.md";
const OUT_JSON = "reports/alternative-odds-coverage.json";
const internalPath = fileURLToPath(new URL("./audit-alternative-odds-coverage-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function run(script: string, env = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    console.error(`[alternative-odds-coverage] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
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

const preflight = run("scripts/audit-alternative-odds-coverage-preflight.ts");
if (preflight !== 0) {
  console.error("[alternative-odds-coverage] FAIL CLOSED: forward cohort preflight did not pass; coverage/readiness output was not generated");
  process.exit(preflight);
}

if (!existsSync(DB_PATH)) throw new Error("ALT_ODDS_COVERAGE_DB_MISSING");
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ALT_ODDS_COVERAGE_DB_HANDOFF_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-alt-odds-coverage-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    handoffDbPath,
    "ALT_ODDS_COVERAGE_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const audit = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (audit.error || audit.status !== 0) {
    throw new Error("ALT_ODDS_COVERAGE_INTERNAL_FAILED");
  }

  const workspaceMd = join(workspace, OUT_MD);
  const workspaceJson = join(workspace, OUT_JSON);
  if (!existsSync(workspaceMd)) throw new Error("ALT_ODDS_COVERAGE_MD_OUTPUT_MISSING");
  if (!existsSync(workspaceJson)) throw new Error("ALT_ODDS_COVERAGE_JSON_OUTPUT_MISSING");
  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    workspaceMd,
    "ALT_ODDS_COVERAGE_MD_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "ALT_ODDS_COVERAGE_JSON_OUTPUT_IDENTITY_INVALID",
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
    "ALT_ODDS_COVERAGE_MD_PUBLISH_TEMP_IDENTITY_INVALID",
    "ALT_ODDS_COVERAGE_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "ALT_ODDS_COVERAGE_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "ALT_ODDS_COVERAGE_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[alternative-odds-coverage] PASS: cohort preflight passed before isolated coverage audit publication");
