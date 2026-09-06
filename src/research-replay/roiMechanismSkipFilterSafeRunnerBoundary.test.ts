import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypointSource = readFileSync("scripts/analyze-roi-mechanism-skip-filters.ts", "utf-8");
const legacyRunnerSource = readFileSync("scripts/run-roi-mechanism-skip-filters-safe.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts", "utf-8");
const analysisSource = readFileSync("scripts/analyze-roi-mechanism-skip-filters-raw.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("ROI mechanism skip-filter normal entrypoint checks payout completeness before raw analysis", () => {
  assert.equal(pkg.scripts?.["analyze:roi-skip-filters"], "tsx scripts/analyze-roi-mechanism-skip-filters.ts");
  const preflight = entrypointSource.indexOf('run("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts")');
  const analysis = entrypointSource.indexOf('run("scripts/analyze-roi-mechanism-skip-filters-raw.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
});

test("ROI mechanism skip-filter normal entrypoint fails closed before exclusion verdicts", () => {
  assert.match(entrypointSource, /if \(preflight !== 0\)/);
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
  assert.ok(
    entrypointSource.indexOf("if (preflight !== 0)") < entrypointSource.indexOf('run("scripts/analyze-roi-mechanism-skip-filters-raw.ts")'),
  );
});

test("legacy ROI mechanism safe runner also targets raw analysis after one preflight", () => {
  const preflight = legacyRunnerSource.indexOf('run("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts")');
  const analysis = legacyRunnerSource.indexOf('run("scripts/analyze-roi-mechanism-skip-filters-raw.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
  assert.doesNotMatch(legacyRunnerSource, /run\("scripts\/analyze-roi-mechanism-skip-filters\.ts"\)/);
});

test("ROI mechanism payout preflight matches raw analyzer population and stays read-only", () => {
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
  assert.match(analysisSource, /getVerdict/);
});
