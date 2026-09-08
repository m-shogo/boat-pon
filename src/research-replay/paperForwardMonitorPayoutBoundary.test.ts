import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypoint = readFileSync("scripts/report-paper-forward-monitor.ts", "utf-8");
const raw = readFileSync("scripts/report-paper-forward-monitor-raw.ts", "utf-8");
const internal = readFileSync("scripts/report-paper-forward-monitor-internal.ts", "utf-8");
const audit = readFileSync("scripts/audit-paper-forward-monitor-payout-completeness.ts", "utf-8");
const pkg = readFileSync("package.json", "utf-8");

test("paper-forward monitor entrypoint fails closed before internal report generation", () => {
  const preflight = entrypoint.indexOf('run("scripts/audit-paper-forward-monitor-payout-completeness.ts")');
  const report = entrypoint.indexOf('run("scripts/report-paper-forward-monitor-internal.ts")');
  assert.ok(preflight >= 0);
  assert.ok(report > preflight);
  assert.match(entrypoint, /if \(preflight !== 0\)/);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
});

test("paper-forward monitor raw compatibility entrypoint is independently guarded and DB-free", () => {
  const preflight = raw.indexOf('run("scripts/audit-paper-forward-monitor-payout-completeness.ts")');
  const report = raw.indexOf('run("scripts/report-paper-forward-monitor-internal.ts")');
  assert.ok(preflight >= 0);
  assert.ok(report > preflight);
  assert.match(raw, /FAIL CLOSED: official trifecta settlement coverage\/integrity did not pass/);
  assert.doesNotMatch(raw, /new DatabaseSync/);
});

test("paper-forward monitor payout preflight covers only settled historical trifecta 1-2-3 BUY rows and stays read-only", () => {
  assert.match(audit, /WITH target_rows AS/);
  assert.match(audit, /SELECT DISTINCT race_id/);
  assert.match(audit, /dh\.decision = 'BUY'/);
  assert.match(audit, /dh\.run_kind = 'historical-backfill'/);
  assert.match(audit, /dh\.result IS NOT NULL/);
  assert.match(audit, /dh\.selection = '1-2-3'/);
  assert.match(audit, /bet_type = '3連単'/);
  assert.match(audit, /returned = 0/);
  assert.match(audit, /rp\.bet_type = 'trifecta'/);
  assert.match(audit, /ts\.returned = 0/);
  assert.match(audit, /ts\.payout_yen > 0/);
  assert.match(audit, /readOnly: true/);
  assert.match(audit, /PRAGMA query_only = ON/);
  assert.match(audit, /assertCanonicalSingleLinkRegularFile/);
  assert.match(audit, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(audit, /PAPER_FORWARD_MONITOR_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
});

test("paper-forward monitor fails closed on decision cohort drift before settlement verdicts", () => {
  assert.match(audit, /tr\.bet_type IS NULL/);
  assert.match(audit, /tr\.bet_type != '3連単'/);
  assert.match(audit, /tr\.returned IS NULL/);
  assert.match(audit, /tr\.returned != 0/);
  assert.match(audit, /cohortInvalidRows/);
  assert.match(audit, /PAPER_FORWARD_MONITOR_COHORT_INVALID/);
  const cohortGate = audit.indexOf("if ((row.cohortInvalidRows ?? 0) > 0)");
  const coverageGate = audit.indexOf("if (!result.complete)");
  assert.ok(cohortGate >= 0);
  assert.ok(coverageGate > cohortGate);
});

test("paper-forward monitor settlement gate accepts legitimate multi-line races but rejects ambiguous or unknown-return lines", () => {
  assert.match(audit, /target_settlements/);
  assert.match(audit, /GROUP BY race_id, combination/);
  assert.match(audit, /HAVING COUNT\(\*\) > 1/);
  assert.match(audit, /duplicateCombinationKeys/);
  assert.match(audit, /invalidNonRefundRows/);
  assert.match(audit, /returnedRows/);
  assert.match(audit, /ts\.returned IS NULL OR ts\.returned != 0/);
  assert.match(audit, /refund or unknown-return settlement rows/);
  assert.match(audit, /ts\.combination IS NULL/);
  assert.match(audit, /ts\.combination = ''/);
  assert.match(audit, /ts\.payout_yen IS NULL/);
  assert.match(audit, /ts\.payout_yen <= 0/);
  assert.doesNotMatch(audit, /HAVING COUNT\(\*\) = 1/);
});

test("paper-forward monitor internal report remains payout dependent and read-only", () => {
  assert.match(internal, /COALESCE/);
  assert.match(internal, /payoutRoi132/);
  assert.match(internal, /switchVerdict/);
  assert.match(internal, /upgradeVerdict/);
  assert.match(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
});

test("paper-forward monitor npm command stays on the fail-closed entrypoint", () => {
  assert.match(pkg, /"report:paper-forward-monitor": "tsx scripts\/report-paper-forward-monitor\.ts"/);
});
