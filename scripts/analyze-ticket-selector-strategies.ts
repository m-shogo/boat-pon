/**
 * analyze-ticket-selector-strategies.ts — research-only fail-closed entrypoint
 *
 * The selector ranks multiple bet types by payout ROI. Direct invocation must
 * first prove that every compared payout market is complete for the exact base
 * research population so missing settlements cannot become zero-return races.
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

const OUT_MD = "reports/ticket-selector-strategies.md";
const OPAQUE_DB_SOURCE = "primary research database";

function run(script: string, env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    console.error(`[ticket-selector] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function publishRedactedReportAtomically(targetPath: string, content: string): void {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx");
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    assertCanonicalSingleLinkRegularFile(tempPath, "TICKET_SELECTOR_TEMP_REPORT_IDENTITY_INVALID");
    renameSync(tempPath, targetPath);
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw error;
  }
}

function redactDbProvenance(dbPath: string): void {
  if (!existsSync(OUT_MD)) {
    throw new Error("TICKET_SELECTOR_REPORT_MISSING_AFTER_ANALYSIS");
  }
  const verifiedReportPath = assertCanonicalSingleLinkRegularFile(
    OUT_MD,
    "TICKET_SELECTOR_REPORT_IDENTITY_INVALID",
  );
  const report = readFileSync(verifiedReportPath, "utf8");
  const provenance = `DB: ${dbPath}`;
  if (!report.includes(provenance)) {
    throw new Error("TICKET_SELECTOR_DB_PROVENANCE_NOT_FOUND");
  }
  const redacted = report.replaceAll(provenance, `DB: ${OPAQUE_DB_SOURCE}`);
  if (redacted.includes(dbPath)) {
    throw new Error("TICKET_SELECTOR_PRIVATE_DB_PATH_REMAINS");
  }
  const handoffReportPath = assertCanonicalSingleLinkRegularFile(
    verifiedReportPath,
    "TICKET_SELECTOR_REPORT_HANDOFF_IDENTITY_INVALID",
  );
  publishRedactedReportAtomically(handoffReportPath, redacted);
}

const preflight = run("scripts/audit-ticket-selector-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[ticket-selector] FAIL CLOSED: compared-market payout coverage is incomplete; ROI/best-strategy analysis was not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "TICKET_SELECTOR_PRIMARY_DB_IDENTITY_INVALID",
);

if (existsSync(OUT_MD)) {
  assertCanonicalSingleLinkRegularFile(
    OUT_MD,
    "TICKET_SELECTOR_PREEXISTING_REPORT_IDENTITY_INVALID",
  );
}

const analysis = run("scripts/analyze-ticket-selector-strategies-core.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: verifiedDbPath,
});
if (analysis !== 0) {
  console.error("[ticket-selector] analysis failed after successful payout completeness preflight");
  process.exit(analysis);
}

redactDbProvenance(verifiedDbPath);
console.log("[ticket-selector] PASS: payout completeness preflight passed before selector analysis");