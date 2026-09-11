/**
 * analyze-roi-skip-policy-simulation.ts — research-only fail-closed entrypoint
 *
 * Require complete official trifecta settlement coverage before the legacy
 * monitor-only skip-policy simulation emits payout-ROI-based policy verdicts.
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

const OUT_MD = "reports/roi-skip-policy-simulation.md";
const OUT_JSON = "reports/roi-skip-policy-simulation.json";
const internalPath = fileURLToPath(new URL("./analyze-roi-skip-policy-simulation-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[roi-skip-policy-entrypoint] failed to start ${script}: ${result.error.message}`);
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

const preflight = run("scripts/audit-roi-skip-policy-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[roi-skip-policy-entrypoint] FAIL CLOSED: settlement completeness preflight did not pass; policy verdicts were not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ROI_SKIP_POLICY_PRIMARY_DB_IDENTITY_INVALID",
);
const childDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "ROI_SKIP_POLICY_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-roi-skip-policy-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const isolatedDbPath = assertCanonicalSingleLinkRegularFile(
    childDbPath,
    "ROI_SKIP_POLICY_DB_ISOLATED_CHILD_HANDOFF_IDENTITY_INVALID",
  );

  const analysis = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: isolatedDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (analysis.error || analysis.status !== 0) {
    throw new Error("ROI_SKIP_POLICY_INTERNAL_FAILED");
  }

  const workspaceMd = join(workspace, OUT_MD);
  const workspaceJson = join(workspace, OUT_JSON);
  if (!existsSync(workspaceMd) || !existsSync(workspaceJson)) {
    throw new Error("ROI_SKIP_POLICY_OUTPUT_MISSING");
  }

  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    workspaceMd,
    "ROI_SKIP_POLICY_MARKDOWN_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "ROI_SKIP_POLICY_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(verifiedMdPath, "utf8");
  const json = readFileSync(verifiedJsonPath, "utf8");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_MD,
    markdown,
    "ROI_SKIP_POLICY_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "ROI_SKIP_POLICY_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[roi-skip-policy-entrypoint] PASS: payout completeness preflight passed before skip-policy simulation");
