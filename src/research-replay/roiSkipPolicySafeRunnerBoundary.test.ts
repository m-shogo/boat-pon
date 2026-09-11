import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/run-roi-skip-policy-simulation-safe.ts", "utf-8");
const entrypointSource = readFileSync("scripts/analyze-roi-skip-policy-simulation.ts", "utf-8");
const rawSource = readFileSync("scripts/analyze-roi-skip-policy-simulation-raw.ts", "utf-8");
const internalSource = readFileSync("scripts/analyze-roi-skip-policy-simulation-internal.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-skip-policy-payout-completeness.ts", "utf-8");
const packageSource = readFileSync("package.json", "utf-8");

test("ROI skip-policy normal entrypoint checks payout completeness before isolated internal simulation", () => {
  const preflight = entrypointSource.indexOf('run("scripts/audit-roi-skip-policy-payout-completeness.ts")');
  const identity = entrypointSource.indexOf("ROI_SKIP_POLICY_PRIMARY_DB_IDENTITY_INVALID");
  const childIdentity = entrypointSource.indexOf("ROI_SKIP_POLICY_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const workspace = entrypointSource.indexOf("mkdtempSync(");
  const isolatedIdentity = entrypointSource.indexOf("ROI_SKIP_POLICY_DB_ISOLATED_CHILD_HANDOFF_IDENTITY_INVALID");
  const analysis = entrypointSource.indexOf("const analysis = spawnSync", isolatedIdentity);
  assert.ok(preflight >= 0);
  assert.ok(identity > preflight);
  assert.ok(childIdentity > identity);
  assert.ok(workspace > childIdentity);
  assert.ok(isolatedIdentity > workspace);
  assert.ok(analysis > isolatedIdentity);
  assert.match(entrypointSource, /if \(preflight !== 0\)/);
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
  assert.match(entrypointSource, /ROI_SKIP_POLICY_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(entrypointSource, /ROI_SKIP_POLICY_DB_CHILD_HANDOFF_IDENTITY_INVALID/);
  assert.match(entrypointSource, /ROI_SKIP_POLICY_DB_ISOLATED_CHILD_HANDOFF_IDENTITY_INVALID/);
  assert.match(entrypointSource, /BOAT_PON_DB_PATH: isolatedDbPath/);
  assert.doesNotMatch(entrypointSource, /BOAT_PON_DB_PATH: childDbPath/);
  assert.doesNotMatch(entrypointSource, /await import\("\.\/analyze-roi-skip-policy-simulation-internal"\)/);
  assert.doesNotMatch(entrypointSource, /analyze-roi-skip-policy-simulation-raw/);
});

test("ROI skip-policy normal entrypoint verifies isolated outputs and publishes them atomically", () => {
  const spawn = entrypointSource.indexOf("const analysis = spawnSync");
  const mdIdentity = entrypointSource.indexOf("ROI_SKIP_POLICY_MARKDOWN_OUTPUT_IDENTITY_INVALID");
  const jsonIdentity = entrypointSource.indexOf("ROI_SKIP_POLICY_JSON_OUTPUT_IDENTITY_INVALID");
  const mdPublish = entrypointSource.indexOf("ROI_SKIP_POLICY_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID");
  const jsonPublish = entrypointSource.indexOf("ROI_SKIP_POLICY_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
  assert.ok(spawn >= 0);
  assert.ok(mdIdentity > spawn);
  assert.ok(jsonIdentity > mdIdentity);
  assert.ok(mdPublish > jsonIdentity);
  assert.ok(jsonPublish > mdPublish);
  assert.match(entrypointSource, /openSync\(tempPath, "wx", 0o600\)/);
  assert.match(entrypointSource, /fsyncSync\(fd\)/);
  assert.match(entrypointSource, /renameSync\(verifiedTempPath, path\)/);
  assert.match(entrypointSource, /rmSync\(workspace, \{ recursive: true, force: true \}\)/);
});

test("ROI skip-policy raw compatibility module rejects direct CLI execution and routes through canonical preflight", () => {
  const guard = rawSource.indexOf("invokedPath === rawEntrypointPath");
  const failure = rawSource.indexOf("ROI_SKIP_POLICY_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const canonical = rawSource.indexOf('await import("./analyze-roi-skip-policy-simulation")');
  assert.ok(guard >= 0);
  assert.ok(failure > guard);
  assert.ok(canonical > failure);
  assert.doesNotMatch(rawSource, /analyze-roi-skip-policy-simulation-internal/);
  assert.doesNotMatch(rawSource, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(rawSource, /assertCanonicalSingleLinkRegularFile/);
});

test("ROI skip-policy legacy safe runner delegates to the canonical fail-closed entrypoint", () => {
  assert.match(runnerSource, /await import\("\.\/analyze-roi-skip-policy-simulation"\)/);
  assert.doesNotMatch(runnerSource, /audit-roi-skip-policy-payout-completeness/);
  assert.doesNotMatch(runnerSource, /analyze-roi-skip-policy-simulation-internal/);
  assert.doesNotMatch(runnerSource, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(runnerSource, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(runnerSource, /spawnSync/);
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
