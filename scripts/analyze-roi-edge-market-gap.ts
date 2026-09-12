/**
 * analyze-roi-edge-market-gap.ts — research-only fail-closed entrypoint
 *
 * Require complete official trifecta settlement coverage before the legacy
 * market-gap analyzer emits 1-2-3 ROI, 1-3-2 missed-opportunity ROI, or verdicts.
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

const OUT_MD = "reports/roi-edge-market-gap.md";
const OUT_JSON = "reports/roi-edge-market-gap.json";
const internalPath = fileURLToPath(new URL("./analyze-roi-edge-market-gap-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[roi-edge-market-gap-entrypoint] failed to start ${script}: ${result.error.message}`);
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

function atomicPublish(path: string, contents: string, errorCode: string, destinationErrorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, contents, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;

    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, errorCode);
    assertExistingOutputIdentity(path, destinationErrorCode);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

const preflight = run("scripts/audit-roi-edge-market-gap-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[roi-edge-market-gap-entrypoint] FAIL CLOSED: official trifecta settlement coverage is incomplete; market-gap ROI/verdicts were not generated");
  process.exit(preflight);
}

await import("./assert-roi-edge-market-gap-db-boundary");
const childDbPath = assertCanonicalSingleLinkRegularFile(
  process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite",
  "ROI_EDGE_MARKET_GAP_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);

assertExistingOutputIdentity(OUT_MD, "ROI_EDGE_MARKET_GAP_MD_PREEXISTING_IDENTITY_INVALID");
assertExistingOutputIdentity(OUT_JSON, "ROI_EDGE_MARKET_GAP_JSON_PREEXISTING_IDENTITY_INVALID");

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-roi-edge-market-gap-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    childDbPath,
    "ROI_EDGE_MARKET_GAP_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const analysis = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (analysis.error || analysis.status !== 0) {
    throw new Error("ROI_EDGE_MARKET_GAP_INTERNAL_FAILED");
  }

  const workspaceMd = assertGeneratedOutputIdentity(
    join(workspace, OUT_MD),
    "ROI_EDGE_MARKET_GAP_MD_WORKSPACE_OUTPUT_MISSING",
    "ROI_EDGE_MARKET_GAP_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID",
  );
  const workspaceJson = assertGeneratedOutputIdentity(
    join(workspace, OUT_JSON),
    "ROI_EDGE_MARKET_GAP_JSON_WORKSPACE_OUTPUT_MISSING",
    "ROI_EDGE_MARKET_GAP_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(workspaceMd, "utf8");
  const json = readFileSync(workspaceJson, "utf8");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_MD,
    markdown,
    "ROI_EDGE_MARKET_GAP_MD_PUBLISH_TEMP_IDENTITY_INVALID",
    "ROI_EDGE_MARKET_GAP_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "ROI_EDGE_MARKET_GAP_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "ROI_EDGE_MARKET_GAP_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );

  if (!existsSync(OUT_MD) || !existsSync(OUT_JSON)) {
    throw new Error("ROI_EDGE_MARKET_GAP_OUTPUT_MISSING");
  }
  assertCanonicalSingleLinkRegularFile(OUT_MD, "ROI_EDGE_MARKET_GAP_MD_OUTPUT_IDENTITY_INVALID");
  assertCanonicalSingleLinkRegularFile(OUT_JSON, "ROI_EDGE_MARKET_GAP_JSON_OUTPUT_IDENTITY_INVALID");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[roi-edge-market-gap-entrypoint] PASS: payout completeness preflight passed before isolated market-gap analysis");