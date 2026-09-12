import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypointSource = readFileSync("scripts/analyze-roi-mechanism-skip-filters.ts", "utf-8");
const legacyRunnerSource = readFileSync("scripts/run-roi-mechanism-skip-filters-safe.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts", "utf-8");
const rawSource = readFileSync("scripts/analyze-roi-mechanism-skip-filters-raw.ts", "utf-8");
const analysisSource = readFileSync("scripts/analyze-roi-mechanism-skip-filters-internal.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("ROI mechanism skip-filter normal entrypoint checks payout completeness before internal analysis", () => {
  assert.equal(pkg.scripts?.["analyze:roi-skip-filters"], "tsx scripts/analyze-roi-mechanism-skip-filters.ts");
  const preflight = entrypointSource.indexOf('run("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts")');
  const handoffIdentity = entrypointSource.indexOf("ROI_MECHANISM_SKIP_FILTER_DB_HANDOFF_IDENTITY_INVALID");
  const analysis = entrypointSource.indexOf('await import("./analyze-roi-mechanism-skip-filters-internal")');
  assert.ok(preflight >= 0);
  assert.ok(handoffIdentity > preflight, "DB identity must be reverified after the settlement preflight");
  assert.ok(analysis > handoffIdentity, "internal analysis must start only after DB handoff identity verification");
  assert.match(entrypointSource, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
  assert.doesNotMatch(entrypointSource, /analyze-roi-mechanism-skip-filters-raw/);
});

test("ROI mechanism skip-filter rejects unsafe pre-existing report paths before legacy analysis writes", () => {
  const dbHandoff = entrypointSource.indexOf("ROI_MECHANISM_SKIP_FILTER_DB_HANDOFF_IDENTITY_INVALID");
  const preexistingIdentity = entrypointSource.indexOf("ROI_MECHANISM_SKIP_FILTER_PREEXISTING_REPORT_IDENTITY_INVALID");
  const analysis = entrypointSource.indexOf('await import("./analyze-roi-mechanism-skip-filters-internal")');

  assert.ok(preexistingIdentity > dbHandoff, "report-path identity preflight must follow verified DB handoff");
  assert.ok(analysis > preexistingIdentity, "legacy analyzer must not write before an existing report path is verified");
  assert.match(entrypointSource, /if \(existsSync\(OUT_MD\)\)/);
});

test("ROI mechanism skip-filter redacts configured DB provenance only after internal analysis completes", () => {
  assert.match(entrypointSource, /OPAQUE_DB_SOURCE = "primary research database"/);
  assert.match(entrypointSource, /ROI_MECHANISM_SKIP_FILTER_REPORT_MISSING_AFTER_ANALYSIS/);
  assert.match(entrypointSource, /ROI_MECHANISM_SKIP_FILTER_DB_PROVENANCE_NOT_FOUND/);
  assert.match(entrypointSource, /const redacted = report\.replaceAll\(privateMarker, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/);
  assert.match(entrypointSource, /ROI_MECHANISM_SKIP_FILTER_PRIVATE_DB_PATH_REMAINS/);
  const analysis = entrypointSource.indexOf('await import("./analyze-roi-mechanism-skip-filters-internal")');
  const redact = entrypointSource.lastIndexOf("redactDbProvenance(handoffDbPath)");
  const pass = entrypointSource.lastIndexOf("[roi-mechanism-skip-filter] PASS");
  assert.ok(analysis >= 0 && redact > analysis && pass > redact);
});

test("ROI mechanism skip-filter verifies report identity and publishes provenance atomically", () => {
  const firstIdentity = entrypointSource.indexOf('"ROI_MECHANISM_SKIP_FILTER_REPORT_IDENTITY_INVALID"');
  const read = entrypointSource.indexOf('readFileSync(verifiedReportPath, "utf-8")');
  const privatePathCheck = entrypointSource.indexOf("ROI_MECHANISM_SKIP_FILTER_PRIVATE_DB_PATH_REMAINS");
  const handoffIdentity = entrypointSource.indexOf('"ROI_MECHANISM_SKIP_FILTER_REPORT_HANDOFF_IDENTITY_INVALID"');
  const publishCall = entrypointSource.indexOf("publishRedactedReportAtomically(handoffReportPath, redacted)");
  const exclusiveOpen = entrypointSource.indexOf('openSync(tempPath, "wx")');
  const fsync = entrypointSource.indexOf("fsyncSync(fd)");
  const tempIdentity = entrypointSource.indexOf('"ROI_MECHANISM_SKIP_FILTER_TEMP_REPORT_IDENTITY_INVALID"');
  const rename = entrypointSource.indexOf("renameSync(tempPath, targetPath)");

  assert.ok(
    firstIdentity >= 0
      && read > firstIdentity
      && privatePathCheck > read
      && handoffIdentity > privatePathCheck
      && publishCall > handoffIdentity,
  );
  assert.ok(exclusiveOpen >= 0 && fsync > exclusiveOpen && tempIdentity > fsync && rename > tempIdentity);
  assert.match(entrypointSource, /assertCanonicalSingleLinkRegularFile\(\s*OUT_MD,/u);
  assert.match(entrypointSource, /assertCanonicalSingleLinkRegularFile\(\s*verifiedReportPath,/u);
  assert.match(entrypointSource, /writeFileSync\(fd, content, "utf-8"\)/u);
  assert.match(entrypointSource, /if \(existsSync\(tempPath\)\) unlinkSync\(tempPath\)/u);
  assert.doesNotMatch(entrypointSource, /writeFileSync\(\s*handoffReportPath/u);
});

test("ROI mechanism skip-filter normal entrypoint fails closed before exclusion verdicts", () => {
  assert.match(entrypointSource, /if \(preflight !== 0\)/);
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
  assert.ok(
    entrypointSource.indexOf("if (preflight !== 0)") < entrypointSource.indexOf('await import("./analyze-roi-mechanism-skip-filters-internal")'),
  );
});

test("legacy ROI mechanism safe runner delegates to the canonical fail-closed entrypoint", () => {
  assert.match(legacyRunnerSource, /await import\("\.\/analyze-roi-mechanism-skip-filters"\)/);
  assert.doesNotMatch(legacyRunnerSource, /audit-roi-mechanism-skip-filter-payout-completeness/);
  assert.doesNotMatch(legacyRunnerSource, /analyze-roi-mechanism-skip-filters-raw/);
});

test("legacy raw module rejects direct CLI execution and routes imported callers through canonical preflight", () => {
  assert.match(rawSource, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(rawSource, /ROI_MECHANISM_SKIP_FILTER_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(rawSource, /await import\("\.\/analyze-roi-mechanism-skip-filters"\)/);
  assert.doesNotMatch(rawSource, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(rawSource, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(rawSource, /analyze-roi-mechanism-skip-filters-internal/);
  assert.doesNotMatch(rawSource, /DatabaseSync/);
});

test("ROI mechanism internal analyzer independently fails closed before SQLite reads", () => {
  const directGuard = analysisSource.indexOf("ROI_MECHANISM_SKIP_FILTER_INTERNAL_DIRECT_EXECUTION_FORBIDDEN");
  const missing = analysisSource.indexOf("ROI_MECHANISM_SKIP_FILTER_INTERNAL_DB_MISSING");
  const identity = analysisSource.indexOf("ROI_MECHANISM_SKIP_FILTER_INTERNAL_DB_IDENTITY_INVALID");
  const open = analysisSource.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = analysisSource.indexOf("PRAGMA query_only = ON");

  assert.ok(directGuard >= 0, "internal analyzer must reject direct CLI execution");
  assert.ok(missing > directGuard, "DB existence check must follow the direct-execution guard");
  assert.ok(identity > missing, "DB identity must be revalidated before SQLite open");
  assert.ok(open > identity, "SQLite must open only the revalidated DB path");
  assert.ok(queryOnly > open, "SQLite connection must be forced query-only after read-only open");
  assert.match(analysisSource, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(analysisSource, /DB not found: \$\{DB_PATH\}/);
  assert.doesNotMatch(analysisSource, /new DatabaseSync\(DB_PATH/);
  assert.doesNotMatch(analysisSource, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
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
