import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/run-roi-skip-policy-simulation-safe.ts", "utf-8");
const entrypointSource = readFileSync("scripts/analyze-roi-skip-policy-simulation.ts", "utf-8");
const rawSource = readFileSync("scripts/analyze-roi-skip-policy-simulation-raw.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-skip-policy-payout-completeness.ts", "utf-8");
const packageSource = readFileSync("package.json", "utf-8");

test("ROI skip-policy normal entrypoint checks payout completeness before raw simulation", () => {
  const preflight = entrypointSource.indexOf('run("scripts/audit-roi-skip-policy-payout-completeness.ts")');
  const analysis = entrypointSource.indexOf('run("scripts/analyze-roi-skip-policy-simulation-raw.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
  assert.match(entrypointSource, /if \(preflight !== 0\)/);
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
});

test("ROI skip-policy legacy safe runner checks payout completeness before raw simulation", () => {
  const preflight = runnerSource.indexOf('run("scripts/audit-roi-skip-policy-payout-completeness.ts")');
  const analysis = runnerSource.indexOf('run("scripts/analyze-roi-skip-policy-simulation-raw.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
  assert.doesNotMatch(runnerSource, /run\("scripts\/analyze-roi-skip-policy-simulation\.ts"\)/);
});

test("ROI skip-policy npm command stays on the fail-closed normal entrypoint", () => {
  assert.match(packageSource, /"analyze:roi-skip-policy": "tsx scripts\/analyze-roi-skip-policy-simulation\.ts"/);
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
  assert.match(rawSource, /主評価: race_payouts\.payout_yen 実払戻ベース/);
  assert.match(rawSource, /COALESCE/);
  assert.match(rawSource, /deriveVerdict/);
});
