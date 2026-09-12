/**
 * analyze-payout-rebase.ts — guarded research-only entrypoint
 *
 * Direct invocation must pass the same settlement-integrity preflight as the
 * canonical safe runner before the legacy payout-rebase analysis is allowed to
 * execute. No DB writes, app_settings changes, production decisions,
 * notifications, or automated betting are performed here.
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/payout-rebase.md";
const OUT_JSON = "reports/payout-rebase.json";
const OPAQUE_DB_SOURCE = "primary research database";
const internalPath = fileURLToPath(new URL("./analyze-payout-rebase-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function runGuarded(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  if (result.error) {
    console.error("[payout-rebase-entrypoint] GUARDED_STEP_SPAWN_FAILED");
    return 1;
  }

  const status = result.status ?? 1;
  if (status !== 0) {
    console.error("[payout-rebase-entrypoint] GUARDED_STEP_FAILED");
    return status;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  return status;
}

function verifyExistingOutputs(): void {
  if (existsSync(OUT_MD)) {
    assertCanonicalSingleLinkRegularFile(
      OUT_MD,
      "PAYOUT_REBASE_PREEXISTING_REPORT_IDENTITY_INVALID",
    );
  }
  if (existsSync(OUT_JSON)) {
    assertCanonicalSingleLinkRegularFile(
      OUT_JSON,
      "PAYOUT_REBASE_PREEXISTING_JSON_IDENTITY_INVALID",
    );
  }
}

function runIsolated(workspace: string, verifiedDbPath: string): number {
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    verifiedDbPath,
    "PAYOUT_REBASE_DB_CHILD_LAUNCH_IDENTITY_INVALID",
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
    console.error("[payout-rebase-entrypoint] INTERNAL_SPAWN_FAILED");
    return 1;
  }
  const status = result.status ?? 1;
  if (status !== 0) {
    console.error("[payout-rebase-entrypoint] INTERNAL_FAILED");
    return status;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  return status;
}

function readIsolatedOutputs(workspace: string, dbPath: string): { markdown: string; json: string } {
  const workspaceMd = join(workspace, OUT_MD);
  const workspaceJson = join(workspace, OUT_JSON);
  if (!existsSync(workspaceMd)) throw new Error("PAYOUT_REBASE_REPORT_MISSING_AFTER_ANALYSIS");
  if (!existsSync(workspaceJson)) throw new Error("PAYOUT_REBASE_JSON_MISSING_AFTER_ANALYSIS");

  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    workspaceMd,
    "PAYOUT_REBASE_REPORT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "PAYOUT_REBASE_JSON_IDENTITY_INVALID",
  );
  const report = readFileSync(verifiedMdPath, "utf8");
  const json = readFileSync(verifiedJsonPath, "utf8");
  const privateMarker = `DB: ${dbPath}`;
  if (!report.includes(privateMarker)) {
    throw new Error("PAYOUT_REBASE_PRIVATE_DB_PROVENANCE_MARKER_MISSING");
  }
  try {
    JSON.parse(json);
  } catch {
    throw new Error("PAYOUT_REBASE_JSON_INVALID");
  }

  assertCanonicalSingleLinkRegularFile(
    verifiedMdPath,
    "PAYOUT_REBASE_REPORT_HANDOFF_IDENTITY_INVALID",
  );
  assertCanonicalSingleLinkRegularFile(
    verifiedJsonPath,
    "PAYOUT_REBASE_JSON_HANDOFF_IDENTITY_INVALID",
  );
  return {
    markdown: report.replaceAll(privateMarker, `DB: ${OPAQUE_DB_SOURCE}`),
    json: json.split(dbPath).join(OPAQUE_DB_SOURCE),
  };
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

const preflight = runGuarded("scripts/audit-odds-payout-gap-completeness.ts");
if (preflight !== 0) {
  console.error("[payout-rebase-entrypoint] FAIL CLOSED: settlement integrity preflight did not pass; payout-based classifications were not generated");
  process.exit(preflight);
}

if (!existsSync(DB_PATH)) {
  throw new Error("PAYOUT_REBASE_PRIMARY_DB_MISSING");
}
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "PAYOUT_REBASE_PRIMARY_DB_IDENTITY_INVALID",
);
verifyExistingOutputs();

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-payout-rebase-"));
let status = 1;
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  status = runIsolated(workspace, verifiedDbPath);
  if (status === 0) {
    const outputs = readIsolatedOutputs(workspace, verifiedDbPath);
    mkdirSync("reports", { recursive: true });
    atomicPublish(
      OUT_JSON,
      outputs.json,
      "PAYOUT_REBASE_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
      "PAYOUT_REBASE_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
    );
    atomicPublish(
      OUT_MD,
      outputs.markdown,
      "PAYOUT_REBASE_MD_PUBLISH_TEMP_IDENTITY_INVALID",
      "PAYOUT_REBASE_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
    );
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
if (status !== 0) process.exit(status);
console.log("[payout-rebase-entrypoint] PASS: settlement integrity preflight and isolated verified publication passed before payout rebase outputs were exposed");