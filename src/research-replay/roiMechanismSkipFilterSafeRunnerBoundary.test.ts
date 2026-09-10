import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypointSource = readFileSync("scripts/analyze-roi-mechanism-skip-filters.ts", "utf-8");
const legacyRunnerSource = readFileSync("scripts/run-roi-mechanism-skip-filters-safe.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts", "utf-8");
const rawSource = readFileSync("scripts/analyze-roi-mechanism-skip-filters-raw.ts", "utf-8");
const analysisSource = readFileSync("scripts/analyze-roi-mechanism-skip-filters-internal.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("ROI mechanism skip-filter normal entrypoint checks payout completeness before guarded analysis", () => {
  assert.equal(pkg.scripts?.["analyze:roi-skip-filters"], "tsx scripts/analyze-roi-mechanism-skip-filters.ts");
  const preflight = entrypointSource.indexOf('run("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts")');
  const handoffIdentity = entrypointSource.indexOf("ROI_MECHANISM_SKIP_FILTER_DB_HANDOFF_IDENTITY_INVALID");
  const analysis = entrypointSource.indexOf('await import("./analyze-roi-mechanism-skip-filters-raw")');
  assert.ok(preflight >= 0);
  assert.ok(handoffIdentity > preflight, "DB identity must be reverified after the settlement preflight");
  assert.ok(analysis > handoffIdentity, "guarded analysis must start only after DB handoff identity verification");
  assert.match(entrypointSource, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
  assert.doesNotMatch(entrypointSource, /run\("scripts\/analyze-roi-mechanism-skip-filters-raw\.ts"\)/);
});

test("ROI mechanism skip-filter redacts configured DB provenance only after guarded analysis completes", () => {
  assert.match(entrypointSource, /OPAQUE_DB_SOURCE = "primary research database"/);
  assert.match(entrypointSource, /ROI_MECHANISM_SKIP_FILTER_REPORT_MISSING_AFTER_ANALYSIS/);
  assert.match(entrypointSource, /ROI_MECHANISM_SKIP_FILTER_DB_PROVENANCE_NOT_FOUND/);
  assert.match(entrypointSource, /report\.replaceAll\(privateMarker, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/);
  const analysis = entrypointSource.indexOf('await import("./analyze-roi-mechanism-skip-filters-raw")');
  const redact = entrypointSource.lastIndexOf("redactDbProvenance(handoffDbPath)");
  const pass = entrypointSource.lastIndexOf("[roi-mechanism-skip-filter] PASS");
  assert.ok(analysis >= 0 && redact > analysis && pass > redact);
});

test("ROI mechanism skip-filter verifies generated report identity before provenance read and again before write", () => {
  const firstIdentity = entrypointSource.indexOf('"ROI_MECHANISM_SKIP_FILTER_REPORT_IDENTITY_INVALID"');
  const read = entrypointSource.indexOf('readFileSync(verifiedReportPath, "utf-8")');
  const handoffIdentity = entrypointSource.indexOf('"ROI_MECHANISM_SKIP_FILTER_REPORT_HANDOFF_IDENTITY_INVALID"');
  const write = entrypointSource.indexOf("writeFileSync(\n    handoffReportPath");

  assert.ok(firstIdentity >= 0 && read > firstIdentity && handoffIdentity > read && write > handoffIdentity);
  assert.match(entrypointSource, /assertCanonicalSingleLinkRegularFile\(\s*OUT_MD,/u);
  assert.match(entrypointSource, /assertCanonicalSingleLinkRegularFile\(\s*verifiedReportPath,/u);
});

test("ROI mechanism skip-filter normal entrypoint fails closed before exclusion verdicts", () => {
  assert.match(entrypointSource, /if \(preflight !== 0\)/);
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
  assert.ok(
    entrypointSource.indexOf("if (preflight !== 0)") < entrypointSource.indexOf('await import("./analyze-roi-mechanism-skip-filters-raw")'),
  );
});

test("legacy ROI mechanism safe runner delegates to the canonical fail-closed entrypoint", () => {
  assert.match(legacyRunnerSource, /await import\("\.\/analyze-roi-mechanism-skip-filters"\)/);
  assert.doesNotMatch(legacyRunnerSource, /audit-roi-mechanism-skip-filter-payout-completeness/);
  assert.doesNotMatch(legacyRunnerSource, /analyze-roi-mechanism-skip-filters-raw/);
});

test("legacy raw module rejects direct CLI execution, revalidates DB identity, and only imports the internal analyzer", () => {
  assert.match(rawSource, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(rawSource, /ROI_MECHANISM_SKIP_FILTER_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(rawSource, /ROI_MECHANISM_SKIP_FILTER_RAW_DB_MISSING/);
  assert.match(rawSource, /ROI_MECHANISM_SKIP_FILTER_RAW_DB_IDENTITY_INVALID/);
  const identity = rawSource.indexOf("assertCanonicalSingleLinkRegularFile(");
  const internal = rawSource.indexOf('await import("./analyze-roi-mechanism-skip-filters-internal")');
  assert.ok(identity >= 0 && internal > identity);
  assert.match(rawSource, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(rawSource, /DatabaseSync/);
});

test("ROI mechanism payout preflight matches internal analyzer population and validates settlement line integrity", () => {
  assert.match(auditSource, /SELECT dh\.race_id, dh\.bet_type, dh\.returned/);
  assert.match(auditSource, /dh\.decision = 'BUY'/);
  assert.match(auditSource, /dh\.run_kind = 'historical-backfill'/);
  assert.match(auditSource, /dh\.current_odds IS NOT NULL/);
  assert.match(auditSource, /dh\.selection = '1-2-3'/);
  assert.match(auditSource, /dh\.date >= \?/);
  assert.match(auditSource, /EXCLUDED_VENUES/);
  assert.match(auditSource, /EXCLUDED_RACES/);
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
  assert.match(auditSource, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(auditSource, /process\.exit\(2\)/);
  assert.match(analysisSource, /主評価: race_payouts\.payout_yen 実払戻ベース/);
  assert.match(analysisSource, /COALESCE/);
  assert.match(analysisSource, /getVerdict/);
});

test("ROI mechanism payout preflight permits legitimate multi-line winners rather than enforcing one row per race", () => {
  assert.doesNotMatch(auditSource, /HAVING COUNT\(\*\) = 1/);
  assert.doesNotMatch(auditSource, /COUNT\(DISTINCT ts\.combination\) = 1/);
});

test("ROI mechanism payout preflight verifies DB identity before read-only SQLite open", () => {
  const verify = auditSource.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = auditSource.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0 && open > verify);
  assert.match(auditSource, /PRAGMA query_only = ON/);
});
