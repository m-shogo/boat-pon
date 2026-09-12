/**
 * analyze-wind24-exh1-switch-deep-dive.ts — research-only fail-closed entrypoint
 *
 * The deep-dive produces ROI-based promotion/demotion verdicts. Missing official
 * trifecta settlements must never be interpreted as zero-return observations,
 * including when this file is invoked directly through npm or tsx.
 */

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const OUT_MD = "reports/wind24-exh1-switch-deep-dive.md";
const OPAQUE_DB_SOURCE = "primary research database";

function run(script: string, env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    console.error(`[wind24-switch] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function publishRedactedReportAtomically(targetPath: string, content: string): void {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx");
    writeFileSync(fd, content, "utf-8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(
      tempPath,
      "WIND24_SWITCH_TEMP_REPORT_IDENTITY_INVALID",
    );
    const verifiedTargetPath = assertCanonicalSingleLinkRegularFile(
      targetPath,
      "WIND24_SWITCH_PUBLISH_DESTINATION_IDENTITY_INVALID",
    );
    renameSync(verifiedTempPath, verifiedTargetPath);
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw error;
  }
}

function redactDbProvenance(dbPath: string): void {
  if (!existsSync(OUT_MD)) {
    throw new Error("WIND24_SWITCH_REPORT_MISSING_AFTER_ANALYSIS");
  }

  const verifiedReportPath = assertCanonicalSingleLinkRegularFile(
    OUT_MD,
    "WIND24_SWITCH_REPORT_IDENTITY_INVALID",
  );
  const report = readFileSync(verifiedReportPath, "utf-8");
  const privateMarker = `DB: ${dbPath}`;
  if (!report.includes(privateMarker)) {
    throw new Error("WIND24_SWITCH_PRIVATE_DB_PROVENANCE_MARKER_MISSING");
  }

  const redacted = report.replaceAll(privateMarker, `DB: ${OPAQUE_DB_SOURCE}`);
  if (redacted.includes(dbPath)) {
    throw new Error("WIND24_SWITCH_PRIVATE_DB_PATH_REMAINS");
  }

  const handoffReportPath = assertCanonicalSingleLinkRegularFile(
    verifiedReportPath,
    "WIND24_SWITCH_REPORT_HANDOFF_IDENTITY_INVALID",
  );
  publishRedactedReportAtomically(handoffReportPath, redacted);
}

const preflight = run("scripts/audit-wind24-exh1-switch-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[wind24-switch] FAIL CLOSED: official trifecta settlement coverage is incomplete; promotion/demotion analysis was not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "WIND24_SWITCH_PRIMARY_DB_IDENTITY_INVALID",
);

if (existsSync(OUT_MD)) {
  assertCanonicalSingleLinkRegularFile(
    OUT_MD,
    "WIND24_SWITCH_PREEXISTING_REPORT_IDENTITY_INVALID",
  );
}

const analysis = run("scripts/analyze-wind24-exh1-switch-deep-dive-internal.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: verifiedDbPath,
  BOAT_PON_WIND24_INTERNAL_GUARD: "1",
});
if (analysis !== 0) {
  console.error("[wind24-switch] deep-dive failed after a successful settlement completeness preflight");
  process.exit(analysis);
}

redactDbProvenance(verifiedDbPath);
console.log("[wind24-switch] PASS: settlement completeness preflight passed before deep-dive analysis");