/**
 * report-paper-forward-monitor.ts — research-only fail-closed entrypoint
 *
 * Require complete official trifecta settlement coverage before the historical
 * paper-forward monitor emits payout ROI, switch/exclusion trends, or upgrade verdicts.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const OUT_MD = "reports/paper-forward-monitor.md";
const OPAQUE_DB_SOURCE = "primary research database";

function run(script: string, env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    console.error(`[paper-forward-monitor-entrypoint] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function atomicPublishSanitizedReport(path: string, content: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf-8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;

    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(
      tempPath,
      "PAPER_FORWARD_MONITOR_SANITIZED_TEMP_IDENTITY_INVALID",
    );
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

function sanitizeDbProvenance(handoffDbPath: string): void {
  if (!existsSync(OUT_MD)) {
    throw new Error("PAPER_FORWARD_MONITOR_REPORT_MISSING_AFTER_INTERNAL_SUCCESS");
  }

  const verifiedReportPath = assertCanonicalSingleLinkRegularFile(
    OUT_MD,
    "PAPER_FORWARD_MONITOR_REPORT_IDENTITY_INVALID",
  );
  const report = readFileSync(verifiedReportPath, "utf-8");
  const sanitized = report
    .split(handoffDbPath).join(OPAQUE_DB_SOURCE)
    .replace(/^DB:.*$/gm, `DB: ${OPAQUE_DB_SOURCE}`);

  if (sanitized.includes(handoffDbPath)) {
    throw new Error("PAPER_FORWARD_MONITOR_PRIVATE_DB_PATH_REMAINS");
  }

  const handoffReportPath = assertCanonicalSingleLinkRegularFile(
    verifiedReportPath,
    "PAPER_FORWARD_MONITOR_REPORT_HANDOFF_IDENTITY_INVALID",
  );
  atomicPublishSanitizedReport(handoffReportPath, sanitized);

  const dbLines = sanitized.match(/^DB:.*$/gm) ?? [];
  if (dbLines.length !== 1 || dbLines[0] !== `DB: ${OPAQUE_DB_SOURCE}`) {
    throw new Error("PAPER_FORWARD_MONITOR_DB_PROVENANCE_UNEXPECTED");
  }
}

const preflight = run("scripts/audit-paper-forward-monitor-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[paper-forward-monitor-entrypoint] FAIL CLOSED: official trifecta settlement coverage is incomplete; monitor ROI/trend/verdict output was not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "PAPER_FORWARD_MONITOR_DB_HANDOFF_IDENTITY_INVALID",
);

if (existsSync(OUT_MD)) {
  assertCanonicalSingleLinkRegularFile(
    OUT_MD,
    "PAPER_FORWARD_MONITOR_PREEXISTING_REPORT_IDENTITY_INVALID",
  );
}

const report = run("scripts/report-paper-forward-monitor-internal.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: handoffDbPath,
  BOAT_PON_PAPER_FORWARD_MONITOR_INTERNAL_GUARD: "1",
});
if (report !== 0) {
  console.error("[paper-forward-monitor-entrypoint] internal report failed after a successful payout completeness preflight");
  process.exit(report);
}

sanitizeDbProvenance(handoffDbPath);
console.log("[paper-forward-monitor-entrypoint] PASS: payout completeness preflight passed before internal monitor report generation");