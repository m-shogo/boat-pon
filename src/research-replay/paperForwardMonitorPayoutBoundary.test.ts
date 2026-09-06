import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypoint = readFileSync("scripts/report-paper-forward-monitor.ts", "utf-8");
const raw = readFileSync("scripts/report-paper-forward-monitor-raw.ts", "utf-8");
const audit = readFileSync("scripts/audit-paper-forward-monitor-payout-completeness.ts", "utf-8");
const pkg = readFileSync("package.json", "utf-8");

test("paper-forward monitor entrypoint fails closed before raw report generation", () => {
  const preflight = entrypoint.indexOf('run("scripts/audit-paper-forward-monitor-payout-completeness.ts")');
  const report = entrypoint.indexOf('run("scripts/report-paper-forward-monitor-raw.ts")');
  assert.ok(preflight >= 0);
  assert.ok(report > preflight);
  assert.match(entrypoint, /if \(preflight !== 0\)/);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
});

test("paper-forward monitor payout preflight covers the historical 1-2-3 BUY union and stays read-only", () => {
  assert.match(audit, /dh\.decision = 'BUY'/);
  assert.match(audit, /dh\.run_kind = 'historical-backfill'/);
  assert.match(audit, /dh\.result IS NOT NULL/);
  assert.match(audit, /dh\.selection = '1-2-3'/);
  assert.match(audit, /rp\.bet_type = 'trifecta'/);
  assert.match(audit, /rp\.payout_yen IS NOT NULL/);
  assert.match(audit, /rp\.payout_yen > 0/);
  assert.match(audit, /readOnly: true/);
  assert.match(audit, /PRAGMA query_only = ON/);
  assert.match(audit, /assertCanonicalSingleLinkRegularFile/);
  assert.match(audit, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(audit, /PAPER_FORWARD_MONITOR_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
});

test("paper-forward monitor raw report remains payout dependent", () => {
  assert.match(raw, /COALESCE/);
  assert.match(raw, /payoutRoi132/);
  assert.match(raw, /switchVerdict/);
  assert.match(raw, /upgradeVerdict/);
});

test("paper-forward monitor npm command stays on the fail-closed entrypoint", () => {
  assert.match(pkg, /"report:paper-forward-monitor": "tsx scripts\/report-paper-forward-monitor\.ts"/);
});
