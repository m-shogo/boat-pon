import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypointSource = readFileSync("scripts/analyze-roi-skip-filter-robustness.ts", "utf-8");
const legacyRunnerSource = readFileSync("scripts/run-roi-skip-filter-robustness-safe.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-skip-filter-robustness-payout-completeness.ts", "utf-8");
const rawSource = readFileSync("scripts/analyze-roi-skip-filter-robustness-raw.ts", "utf-8");
const analysisSource = readFileSync("scripts/analyze-roi-skip-filter-robustness-internal.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("skip-filter robustness normal entrypoint checks payout completeness before isolated internal analysis", () => {
  assert.equal(pkg.scripts?.["analyze:roi-skip-robustness"], "tsx scripts/analyze-roi-skip-filter-robustness.ts");
  const preflight = entrypointSource.indexOf('run("scripts/audit-roi-skip-filter-robustness-payout-completeness.ts")');
  const handoffIdentity = entrypointSource.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_DB_HANDOFF_IDENTITY_INVALID");
  const childIdentity = entrypointSource.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const isolatedIdentity = entrypointSource.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_DB_ISOLATED_CHILD_HANDOFF_IDENTITY_INVALID");
  const launchIdentity = entrypointSource.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const analysis = entrypointSource.indexOf("const analysis = spawnSync", launchIdentity);
  assert.ok(preflight >= 0);
  assert.ok(handoffIdentity > preflight, "DB identity must be reverified after the settlement preflight");
  assert.ok(childIdentity > handoffIdentity, "child DB identity must follow canonical handoff validation");
  assert.ok(isolatedIdentity > childIdentity, "isolated child DB identity must be reverified after workspace creation");
  assert.ok(launchIdentity > isolatedIdentity, "DB identity must be reverified immediately before isolated child launch");
  assert.ok(analysis > launchIdentity, "internal analysis must start only after launch-time DB identity verification");
  assert.match(entrypointSource, /cwd: workspace/);
  assert.match(entrypointSource, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(entrypointSource, /await import\("\.\/analyze-roi-skip-filter-robustness-internal"\)/);
  assert.doesNotMatch(entrypointSource, /analyze-roi-skip-filter-robustness-raw/);
});

test("skip-filter robustness normal entrypoint fails closed before final verdicts", () => {
  assert.match(entrypointSource, /if \(preflight !== 0\)/);
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
  assert.ok(entrypointSource.indexOf("if (preflight !== 0)") < entrypointSource.indexOf("const analysis = spawnSync"));
  assert.match(entrypointSource, /ROI_SKIP_FILTER_ROBUSTNESS_INTERNAL_FAILED/);
});

test("skip-filter robustness verifies isolated outputs and publishes them atomically", () => {
  const launch = entrypointSource.indexOf("const analysis = spawnSync");
  const mdIdentity = entrypointSource.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_MD_OUTPUT_IDENTITY_INVALID");
  const jsonIdentity = entrypointSource.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_JSON_OUTPUT_IDENTITY_INVALID");
  const readMd = entrypointSource.indexOf("readFileSync(verifiedMdPath");
  const readJson = entrypointSource.indexOf("readFileSync(verifiedJsonPath");
  const publishMd = entrypointSource.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_MD_PUBLISH_TEMP_IDENTITY_INVALID");
  const publishJson = entrypointSource.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
  assert.ok(mdIdentity > launch);
  assert.ok(jsonIdentity > launch);
  assert.ok(readMd > mdIdentity);
  assert.ok(readJson > jsonIdentity);
  assert.ok(publishMd > readMd);
  assert.ok(publishJson > readJson);
  assert.match(entrypointSource, /openSync\(tempPath, "wx", 0o600\)/);
  assert.match(entrypointSource, /fsyncSync\(fd\)/);
  assert.match(entrypointSource, /renameSync\(verifiedTempPath, path\)/);
  assert.match(entrypointSource, /\.split\(launchDbPath\)\s*\.join\("verified read-only research DB"\)/);
  assert.match(entrypointSource, /rmSync\(workspace, \{ recursive: true, force: true \}\)/);
});

test("skip-filter robustness internal revalidates DB identity and enforces query-only", () => {
  const verify = analysisSource.search(/assertCanonicalSingleLinkRegularFile\(\s*DB_PATH,/);
  const open = analysisSource.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = analysisSource.indexOf("PRAGMA query_only = ON", open);
  assert.ok(verify >= 0, "internal DB identity validation must exist");
  assert.ok(open > verify, "internal DB open must use the verified canonical path");
  assert.ok(queryOnly > open, "query_only must be enabled immediately after opening the internal DB");
  assert.doesNotMatch(analysisSource, /DB not found: \$\{DB_PATH\}/);
  assert.doesNotMatch(analysisSource, /DB: \$\{DB_PATH\}/);
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