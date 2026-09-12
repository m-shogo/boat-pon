/**
 * Fail-closed ROI mechanism skip-filter entrypoint.
 * Research-only: require complete official trifecta settlement coverage before
 * the internal exclusion-effect analyzer can emit payout-ROI-based verdicts.
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

const OUT_MD = "reports/roi-mechanism-skip-filters.md";
const OPAQUE_DB_SOURCE = "primary research database";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[roi-mechanism-skip-filter] failed to start ${script}: ${result.error.message}`);
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
    assertCanonicalSingleLinkRegularFile(
      tempPath,
      "ROI_MECHANISM_SKIP_FILTER_TEMP_REPORT_IDENTITY_INVALID",
    );
    renameSync(tempPath, targetPath);
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw error;
  }
}

function redactDbProvenance(dbPath: string): void {
  if (!existsSync(OUT_MD)) {
    throw new Error("ROI_MECHANISM_SKIP_FILTER_REPORT_MISSING_AFTER_ANALYSIS");
  }

  const verifiedReportPath = assertCanonicalSingleLinkRegularFile(
    OUT_MD,
    "ROI_MECHANISM_SKIP_FILTER_REPORT_IDENTITY_INVALID",
  );
  const report = readFileSync(verifiedReportPath, "utf-8");
  const privateMarker = `DB: ${dbPath}`;
  if (!report.includes(privateMarker)) {
    throw new Error("ROI_MECHANISM_SKIP_FILTER_DB_PROVENANCE_NOT_FOUND");
  }

  const redacted = report.replaceAll(privateMarker, `DB: ${OPAQUE_DB_SOURCE}`);
  if (redacted.includes(dbPath)) {
    throw new Error("ROI_MECHANISM_SKIP_FILTER_PRIVATE_DB_PATH_REMAINS");
  }

  const handoffReportPath = assertCanonicalSingleLinkRegularFile(
    verifiedReportPath,
    "ROI_MECHANISM_SKIP_FILTER_REPORT_HANDOFF_IDENTITY_INVALID",
  );
  publishRedactedReportAtomically(handoffReportPath, redacted);
}

const preflight = run("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[roi-mechanism-skip-filter] FAIL CLOSED: settlement completeness preflight did not pass; exclusion verdicts were not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ROI_MECHANISM_SKIP_FILTER_DB_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = handoffDbPath;

if (existsSync(OUT_MD)) {
  assertCanonicalSingleLinkRegularFile(
    OUT_MD,
    "ROI_MECHANISM_SKIP_FILTER_PREEXISTING_REPORT_IDENTITY_INVALID",
  );
}

await import("./analyze-roi-mechanism-skip-filters-internal");
redactDbProvenance(handoffDbPath);
console.log("[roi-mechanism-skip-filter] PASS: payout completeness preflight passed before internal analysis");
