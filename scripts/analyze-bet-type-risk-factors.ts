/**
 * analyze-bet-type-risk-factors.ts — research-only fail-closed entrypoint
 *
 * The counterfactual bet-type risk analysis may run only after its historical
 * BUY population is verified as canonical settled trifecta data. This launcher
 * performs no DB writes, production decisions, notifications, or betting.
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

const OUT_MD = "reports/bet-type-risk-factors.md";
const OUT_JSON = "reports/bet-type-risk-factors.json";
const OPAQUE_DB_SOURCE = "primary research database";
const internalPath = fileURLToPath(new URL("./analyze-bet-type-risk-factors-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function run(script: string, env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    console.error(`[bet-type-risk] failed to start ${script}: ${result.error.message}`);
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

function verifyExistingDestination(path: string, code: string): void {
  if (existsSync(path)) assertCanonicalSingleLinkRegularFile(path, code);
}

function atomicPublish(path: string, content: string, code: string): void {
  const parentPath = dirname(path);
  assertCanonicalDirectory(parentPath, `BET_TYPE_RISK_${code}_PUBLISH_PARENT_IDENTITY_INVALID`);
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
      `BET_TYPE_RISK_${code}_PUBLISH_TEMP_IDENTITY_INVALID`,
    );
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(
        path,
        `BET_TYPE_RISK_${code}_PUBLISH_DESTINATION_IDENTITY_INVALID`,
      );
    }
    assertCanonicalDirectory(parentPath, `BET_TYPE_RISK_${code}_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID`);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

function redactDbProvenance(content: string, dbPath: string, code: string, requireProvenance: boolean): string {
  if (requireProvenance && !content.includes(dbPath)) {
    throw new Error(`BET_TYPE_RISK_${code}_DB_PROVENANCE_NOT_FOUND`);
  }
  const redacted = content.split(dbPath).join(OPAQUE_DB_SOURCE);
  if (redacted.includes(dbPath)) {
    throw new Error(`BET_TYPE_RISK_${code}_PRIVATE_DB_PATH_REMAINS`);
  }
  return redacted;
}

const preflight = run("scripts/audit-bet-type-risk-factors-cohort.ts");
if (preflight !== 0) {
  console.error("[bet-type-risk] FAIL CLOSED: canonical historical cohort preflight did not pass; risk-factor ROI output was not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "BET_TYPE_RISK_PRIMARY_DB_IDENTITY_INVALID",
);

// Reverify immediately before the isolated child launch so a path swap cannot
// bypass the successful preflight/identity checks.
const launchDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "BET_TYPE_RISK_CHILD_LAUNCH_DB_IDENTITY_INVALID",
);
const workspace = mkdtempSync(join(tmpdir(), "boat-pon-bet-type-risk-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const loader = `await import(${JSON.stringify(pathToFileURL(internalPath).href)})`;
  const analysis = spawnSync(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "--eval", loader],
    {
      cwd: workspace,
      env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (analysis.error || analysis.status !== 0) {
    throw new Error("BET_TYPE_RISK_INTERNAL_FAILED");
  }

  const stagedMdPath = join(workspace, OUT_MD);
  const stagedJsonPath = join(workspace, OUT_JSON);
  if (!existsSync(stagedMdPath)) throw new Error("BET_TYPE_RISK_MD_OUTPUT_MISSING");
  if (!existsSync(stagedJsonPath)) throw new Error("BET_TYPE_RISK_JSON_OUTPUT_MISSING");

  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    stagedMdPath,
    "BET_TYPE_RISK_MD_STAGED_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    stagedJsonPath,
    "BET_TYPE_RISK_JSON_STAGED_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = redactDbProvenance(readFileSync(verifiedMdPath, "utf8"), launchDbPath, "MD", true);
  const json = redactDbProvenance(readFileSync(verifiedJsonPath, "utf8"), launchDbPath, "JSON", false);

  mkdirSync("reports", { recursive: true });
  assertCanonicalDirectory("reports", "BET_TYPE_RISK_REPORTS_DIRECTORY_IDENTITY_INVALID");
  verifyExistingDestination(OUT_MD, "BET_TYPE_RISK_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID");
  verifyExistingDestination(OUT_JSON, "BET_TYPE_RISK_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID");
  atomicPublish(OUT_MD, markdown, "MD");
  atomicPublish(OUT_JSON, json, "JSON");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[bet-type-risk] PASS: cohort preflight passed before isolated risk-factor analysis");
