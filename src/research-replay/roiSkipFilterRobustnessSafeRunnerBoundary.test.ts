import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypointSource = readFileSync("scripts/analyze-roi-skip-filter-robustness.ts", "utf-8");
const legacyRunnerSource = readFileSync("scripts/run-roi-skip-filter-robustness-safe.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-skip-filter-robustness-payout-completeness.ts", "utf-8");
const rawSource = readFileSync("scripts/analyze-roi-skip-filter-robustness-raw.ts", "utf-8");
const analysisSource = readFileSync("scripts/analyze-roi-skip-filter-robustness-internal.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("skip-filter robustness normal entrypoint checks payout completeness before internal analysis", () => {
  assert.equal(pkg.scripts?.["analyze:roi-skip-robustness"], "tsx scripts/analyze-roi-skip-filter-robustness.ts");
  const preflight = entrypointSource.indexOf('run("scripts/audit-roi-skip-filter-robustness-payout-completeness.ts")');
  const handoffIdentity = entrypointSource.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_DB_HANDOFF_IDENTITY_INVALID");
  const analysis = entrypointSource.indexOf('await import("./analyze-roi-skip-filter-robustness-internal")');
  assert.ok(preflight >= 0);
  assert.ok(handoffIdentity > preflight, "DB identity must be reverified after the settlement preflight");
  assert.ok(analysis > handoffIdentity, "internal analysis must start only after DB handoff identity verification");
  assert.match(entrypointSource, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
  assert.doesNotMatch(entrypointSource, /analyze-roi-skip-filter-robustness-raw/);
});

test("skip-filter robustness normal entrypoint fails closed before final verdicts", () => {
  assert.match(entrypointSource, /if \(preflight !== 0\)/);
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
  assert.ok(entrypointSource.indexOf("if (preflight !== 0)") < entrypointSource.indexOf('await import("./analyze-roi-skip-filter-robustness-internal")'));
});

test("legacy skip-filter robustness safe runner delegates to canonical fail-closed entrypoint", () => {
  assert.match(legacyRunnerSource, /await import\("\.\/analyze-roi-skip-filter-robustness"\)/);
  assert.doesNotMatch(legacyRunnerSource, /audit-roi-skip-filter-robustness-payout-completeness/);
  assert.doesNotMatch(legacyRunnerSource, /analyze-roi-skip-filter-robustness-raw/);
});

test("legacy raw module rejects direct CLI execution and routes imported callers through canonical preflight", () => {
  assert.match(rawSource, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(rawSource, /ROI_SKIP_FILTER_ROBUSTNESS_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(rawSource, /await import\("\.\/analyze-roi-skip-filter-robustness"\)/);
  assert.doesNotMatch(rawSource, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(rawSource, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(rawSource, /analyze-roi-skip-filter-robustness-internal/);
  assert.doesNotMatch(rawSource, /DatabaseSync/);
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
