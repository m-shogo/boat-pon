import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/run-roi-skip-filter-robustness-safe.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-skip-filter-robustness-payout-completeness.ts", "utf-8");
const analysisSource = readFileSync("scripts/analyze-roi-skip-filter-robustness.ts", "utf-8");

test("skip-filter robustness safe runner checks payout completeness before analysis", () => {
  const preflight = runnerSource.indexOf('run("scripts/audit-roi-skip-filter-robustness-payout-completeness.ts")');
  const analysis = runnerSource.indexOf('run("scripts/analyze-roi-skip-filter-robustness.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
});

test("skip-filter robustness safe runner fails closed before final verdicts", () => {
  assert.match(runnerSource, /if \(preflight !== 0\)/);
  assert.match(runnerSource, /process\.exit\(preflight\)/);
  assert.ok(runnerSource.indexOf("if (preflight !== 0)") < runnerSource.indexOf('run("scripts/analyze-roi-skip-filter-robustness.ts")'));
});

test("payout preflight matches the robustness population and remains read-only", () => {
  assert.match(auditSource, /dh\.decision = 'BUY'/);
  assert.match(auditSource, /dh\.run_kind = 'historical-backfill'/);
  assert.match(auditSource, /dh\.current_odds IS NOT NULL/);
  assert.match(auditSource, /dh\.selection = '1-2-3'/);
  assert.match(auditSource, /dh\.date >= \?/);
  assert.match(auditSource, /rp\.bet_type = 'trifecta'/);
  assert.match(auditSource, /readOnly: true/);
  assert.match(auditSource, /PRAGMA query_only = ON/);
  assert.match(auditSource, /assertCanonicalSingleLinkRegularFile/);
  assert.match(auditSource, /total > 0 && covered === total/);
  assert.match(analysisSource, /finalVerdict/);
  assert.match(analysisSource, /COALESCE/);
});
