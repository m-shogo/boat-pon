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
