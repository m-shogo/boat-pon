import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/run-roi-skip-policy-simulation-safe.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-skip-policy-payout-completeness.ts", "utf-8");
const analysisSource = readFileSync("scripts/analyze-roi-skip-policy-simulation.ts", "utf-8");

test("ROI skip-policy safe runner checks payout completeness before simulation", () => {
  const preflight = runnerSource.indexOf('run("scripts/audit-roi-skip-policy-payout-completeness.ts")');
  const analysis = runnerSource.indexOf('run("scripts/analyze-roi-skip-policy-simulation.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
});

test("ROI skip-policy safe runner fails closed before policy verdicts", () => {
  assert.match(runnerSource, /if \(preflight !== 0\)/);
  assert.match(runnerSource, /process\.exit\(preflight\)/);
  assert.ok(
    runnerSource.indexOf("if (preflight !== 0)") < runnerSource.indexOf('run("scripts/analyze-roi-skip-policy-simulation.ts")'),
  );
});

test("ROI skip-policy payout preflight matches simulator population and stays read-only", () => {
  assert.match(auditSource, /dh\.decision = 'BUY'/);
  assert.match(auditSource, /dh\.run_kind = 'historical-backfill'/);
  assert.match(auditSource, /dh\.current_odds IS NOT NULL/);
  assert.match(auditSource, /dh\.selection = '1-2-3'/);
  assert.match(auditSource, /dh\.date >= \?/);
  assert.match(auditSource, /rp\.bet_type = 'trifecta'/);
  assert.match(auditSource, /readOnly: true/);
  assert.match(auditSource, /PRAGMA query_only = ON/);
  assert.match(auditSource, /assertCanonicalSingleLinkRegularFile/);
  assert.match(auditSource, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(analysisSource, /主評価: race_payouts\.payout_yen 実払戻ベース/);
  assert.match(analysisSource, /COALESCE/);
  assert.match(analysisSource, /deriveVerdict/);
});
