import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypointSource = readFileSync("scripts/analyze-roi-skip-filter-robustness.ts", "utf-8");
const legacyRunnerSource = readFileSync("scripts/run-roi-skip-filter-robustness-safe.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-skip-filter-robustness-payout-completeness.ts", "utf-8");
const analysisSource = readFileSync("scripts/analyze-roi-skip-filter-robustness-raw.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("skip-filter robustness normal entrypoint checks payout completeness before raw analysis", () => {
  assert.equal(pkg.scripts?.["analyze:roi-skip-robustness"], "tsx scripts/analyze-roi-skip-filter-robustness.ts");
  const preflight = entrypointSource.indexOf('run("scripts/audit-roi-skip-filter-robustness-payout-completeness.ts")');
  const analysis = entrypointSource.indexOf('run("scripts/analyze-roi-skip-filter-robustness-raw.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
});

test("skip-filter robustness normal entrypoint fails closed before final verdicts", () => {
  assert.match(entrypointSource, /if \(preflight !== 0\)/);
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
  assert.ok(entrypointSource.indexOf("if (preflight !== 0)") < entrypointSource.indexOf('run("scripts/analyze-roi-skip-filter-robustness-raw.ts")'));
});

test("legacy skip-filter robustness safe runner also targets raw analysis after one preflight", () => {
  const preflight = legacyRunnerSource.indexOf('run("scripts/audit-roi-skip-filter-robustness-payout-completeness.ts")');
  const analysis = legacyRunnerSource.indexOf('run("scripts/analyze-roi-skip-filter-robustness-raw.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
  assert.doesNotMatch(legacyRunnerSource, /run\("scripts\/analyze-roi-skip-filter-robustness\.ts"\)/);
});

test("payout preflight matches the robustness population and validates cohort and settlement integrity", () => {
  assert.match(auditSource, /SELECT dh\.race_id, dh\.bet_type, dh\.returned/);
  assert.match(auditSource, /dh\.decision = 'BUY'/);
  assert.match(auditSource, /dh\.run_kind = 'historical-backfill'/);
  assert.match(auditSource, /dh\.current_odds IS NOT NULL/);
  assert.match(auditSource, /dh\.selection = '1-2-3'/);
  assert.match(auditSource, /dh\.date >= \?/);
  assert.match(auditSource, /bet_type = '3連単'/);
  assert.match(auditSource, /returned = 0/);
  assert.match(auditSource, /tr\.bet_type IS NULL/);
  assert.match(auditSource, /tr\.bet_type != '3連単'/);
  assert.match(auditSource, /tr\.returned IS NULL/);
  assert.match(auditSource, /tr\.returned != 0/);
  assert.match(auditSource, /cohortInvalidRows/);
  assert.match(auditSource, /non-3連単 or returned\/unknown-return historical BUY rows/);
  assert.match(auditSource, /rp\.bet_type = 'trifecta'/);
  assert.match(auditSource, /ts\.returned = 0/);
  assert.match(auditSource, /ts\.returned IS NULL OR ts\.returned != 0/);
  assert.match(auditSource, /refund or unknown-return settlement rows/);
  assert.match(auditSource, /ts\.payout_yen > 0/);
  assert.match(auditSource, /ts\.payout_yen <= 0/);
  assert.match(auditSource, /ts\.combination IS NULL/);
  assert.match(auditSource, /HAVING COUNT\(\*\) > 1/);
  assert.match(auditSource, /duplicateCombinationKeys/);
  assert.match(auditSource, /returnedRows/);
  assert.match(auditSource, /invalidNonRefundRows/);
  assert.match(auditSource, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(auditSource, /process\.exit\(2\)/);
  assert.match(analysisSource, /finalVerdict/);
  assert.match(analysisSource, /COALESCE/);
  assert.match(analysisSource, /LIMIT 1/);
});

test("payout preflight permits legitimate multi-line winners instead of enforcing one settlement per race", () => {
  assert.doesNotMatch(auditSource, /HAVING COUNT\(\*\) = 1/);
  assert.doesNotMatch(auditSource, /COUNT\(DISTINCT ts\.combination\) = 1/);
});

test("payout preflight verifies DB identity before read-only query-only access", () => {
  const verify = auditSource.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = auditSource.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0 && open > verify);
  assert.match(auditSource, /PRAGMA query_only = ON/);
});
