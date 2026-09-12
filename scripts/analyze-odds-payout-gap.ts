/**
 * odds-payout-gap fail-closed entrypoint implementation.
 * Runs official trifecta settlement completeness validation before the legacy
 * odds-vs-payout analysis. No DB writes, app_settings changes, production
 * decisions, notifications, or betting.
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

const OUT_MD = "reports/odds-payout-gap.md";
const OUT_JSON = "reports/odds-payout-gap.json";
const internalPath = fileURLToPath(new URL("./analyze-odds-payout-gap-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[odds-payout-gap-safe-runner] failed to start ${script}: ${result.error.message}`);
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

function atomicPublish(
  path: string,
  contents: string,
  tempErrorCode: string,
  destinationErrorCode: string,
): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, contents, "utf8");
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

const preflight = run("scripts/audit-odds-payout-gap-completeness.ts");
if (preflight !== 0) {
  console.error("[odds-payout-gap-safe-runner] FAIL CLOSED: payout completeness preflight did not pass; payout ROI/verdict analysis was not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(configuredDbPath)) throw new Error("ODDS_PAYOUT_GAP_DB_MISSING");
const childDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ODDS_PAYOUT_GAP_DB_IDENTITY_INVALID",
);

assertExistingOutputIdentity(OUT_MD, "ODDS_PAYOUT_GAP_MD_PREEXISTING_IDENTITY_INVALID");
assertExistingOutputIdentity(OUT_JSON, "ODDS_PAYOUT_GAP_JSON_PREEXISTING_IDENTITY_INVALID");

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-odds-payout-gap-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    childDbPath,
    "ODDS_PAYOUT_GAP_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const analysis = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (analysis.error || analysis.status !== 0) throw new Error("ODDS_PAYOUT_GAP_INTERNAL_FAILED");

  const workspaceMd = assertGeneratedOutputIdentity(
    join(workspace, OUT_MD),
    "ODDS_PAYOUT_GAP_MD_WORKSPACE_OUTPUT_MISSING",
    "ODDS_PAYOUT_GAP_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID",
  );
  const workspaceJson = assertGeneratedOutputIdentity(
    join(workspace, OUT_JSON),
    "ODDS_PAYOUT_GAP_JSON_WORKSPACE_OUTPUT_MISSING",
    "ODDS_PAYOUT_GAP_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(workspaceMd, "utf8");
  const json = readFileSync(workspaceJson, "utf8");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_MD,
    markdown,
    "ODDS_PAYOUT_GAP_MD_PUBLISH_TEMP_IDENTITY_INVALID",
    "ODDS_PAYOUT_GAP_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "ODDS_PAYOUT_GAP_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "ODDS_PAYOUT_GAP_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );

  assertCanonicalSingleLinkRegularFile(OUT_MD, "ODDS_PAYOUT_GAP_MD_OUTPUT_IDENTITY_INVALID");
  assertCanonicalSingleLinkRegularFile(OUT_JSON, "ODDS_PAYOUT_GAP_JSON_OUTPUT_IDENTITY_INVALID");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[odds-payout-gap-safe-runner] PASS: completeness preflight passed before isolated odds-payout-gap analysis");
