import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/run-roi-skip-policy-simulation-safe.ts", "utf-8");
const entrypointSource = readFileSync("scripts/analyze-roi-skip-policy-simulation.ts", "utf-8");
const rawSource = readFileSync("scripts/analyze-roi-skip-policy-simulation-raw.ts", "utf-8");
const internalSource = readFileSync("scripts/analyze-roi-skip-policy-simulation-internal.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-skip-policy-payout-completeness.ts", "utf-8");
const packageSource = readFileSync("package.json", "utf-8");

test("ROI skip-policy normal entrypoint checks payout completeness before guarded raw import", () => {
  const preflight = entrypointSource.indexOf('run("scripts/audit-roi-skip-policy-payout-completeness.ts")');
  const identity = entrypointSource.indexOf("assertCanonicalSingleLinkRegularFile(");
  const analysis = entrypointSource.indexOf('await import("./analyze-roi-skip-policy-simulation-raw")');
  assert.ok(preflight >= 0);
  assert.ok(identity > preflight);
  assert.ok(analysis > identity);
  assert.match(entrypointSource, /if \(preflight !== 0\)/);
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
  assert.match(entrypointSource, /ROI_SKIP_POLICY_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(entrypointSource, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(entrypointSource, /run\("scripts\/analyze-roi-skip-policy-simulation-raw\.ts"\)/);
});

test("ROI skip-policy raw compatibility module rejects direct CLI execution", () => {
  const guard = rawSource.indexOf("invokedPath === rawEntrypointPath");
  const failure = rawSource.indexOf("ROI_SKIP_POLICY_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const internal = rawSource.indexOf('await import("./analyze-roi-skip-policy-simulation-internal")');
  assert.ok(guard >= 0);
  assert.ok(failure > guard);
  assert.ok(internal > failure);
});

test("ROI skip-policy legacy safe runner checks payout completeness before internal simulation", () => {
  const preflight = runnerSource.indexOf('run("scripts/audit-roi-skip-policy-payout-completeness.ts")');
  const analysis = runnerSource.indexOf('run("scripts/analyze-roi-skip-policy-simulation-internal.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
  assert.doesNotMatch(runnerSource, /run\("scripts\/analyze-roi-skip-policy-simulation-raw\.ts"\)/);
  assert.doesNotMatch(runnerSource, /run\("scripts\/analyze-roi-skip-policy-simulation\.ts"\)/);
});

test("ROI skip-policy npm command stays on the fail-closed normal entrypoint", () => {
  assert.match(packageSource, /"analyze:roi-skip-policy": "tsx scripts\/analyze-roi-skip-policy-simulation\.ts"/);
});

test("ROI skip-policy payout preflight matches simulator population and validates settlement line integrity", () => {
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
  assert.match(internalSource, /主評価: race_payouts\.payout_yen 実払戻ベース/);
  assert.match(internalSource, /COALESCE/);
  assert.match(internalSource, /deriveVerdict/);
  assert.match(internalSource, /LIMIT 1/);
});

test("ROI skip-policy payout preflight permits legitimate multi-line winners instead of enforcing one settlement per race", () => {
  assert.doesNotMatch(auditSource, /HAVING COUNT\(\*\) = 1/);
  assert.doesNotMatch(auditSource, /COUNT\(DISTINCT ts\.combination\) = 1/);
});

test("ROI skip-policy payout preflight verifies DB identity before read-only query-only access", () => {
  const verify = auditSource.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = auditSource.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0 && open > verify);
  assert.match(auditSource, /PRAGMA query_only = ON/);
});
