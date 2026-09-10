import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-skip-interactions.ts", "utf-8");
const raw = readFileSync("scripts/analyze-roi-skip-interactions-raw.ts", "utf-8");
const audit = readFileSync("scripts/audit-roi-skip-interactions-payout-completeness.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("skip-interactions command cannot bypass settlement completeness", () => {
  assert.equal(pkg.scripts?.["analyze:roi-skip-interactions"], "tsx scripts/analyze-roi-skip-interactions.ts");
  const preflight = entrypoint.indexOf('run("scripts/audit-roi-skip-interactions-payout-completeness.ts")');
  const verify = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(");
  const guarded = entrypoint.indexOf('await import("./analyze-roi-skip-interactions-raw")');
  assert.ok(preflight >= 0);
  assert.ok(verify > preflight);
  assert.ok(guarded > verify);
  assert.match(entrypoint, /if \(preflight !== 0\)[\s\S]*process\.exit\(preflight\)/);
  assert.equal(Object.values(pkg.scripts ?? {}).some((command) => command.includes("analyze-roi-skip-interactions-core.ts")), false);
  assert.equal(Object.values(pkg.scripts ?? {}).some((command) => command.includes("analyze-roi-skip-interactions-raw.ts")), false);
  assert.doesNotMatch(entrypoint, /run\("scripts\/analyze-roi-skip-interactions-raw\.ts"/);
});

test("skip-interactions canonical entrypoint re-verifies DB identity before guarded raw in-process handoff", () => {
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_PRIMARY_DB_MISSING/);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_PRIMARY_DB_IDENTITY_INVALID/);
  assert.doesNotMatch(entrypoint, /DB not found:/);
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = verifiedDbPath/);

  const preflight = entrypoint.indexOf('run("scripts/audit-roi-skip-interactions-payout-completeness.ts")');
  const verify = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(");
  const envHandoff = entrypoint.indexOf("process.env.BOAT_PON_DB_PATH = verifiedDbPath");
  const analysis = entrypoint.indexOf('await import("./analyze-roi-skip-interactions-raw")');
  assert.ok(preflight >= 0 && verify > preflight && envHandoff > verify && analysis > envHandoff);
  assert.equal(entrypoint.includes("analyze-roi-skip-interactions-core.ts"), false);
});

test("skip-interactions guarded raw compatibility module revalidates DB identity immediately before core import", () => {
  const directGuard = raw.indexOf("ROI_SKIP_INTERACTIONS_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const identity = raw.indexOf("ROI_SKIP_INTERACTIONS_RAW_DB_IDENTITY_INVALID");
  const coreImport = raw.indexOf('await import("./analyze-roi-skip-interactions-core")');

  assert.ok(directGuard >= 0 && identity > directGuard && coreImport > identity);
  assert.match(raw, /ROI_SKIP_INTERACTIONS_RAW_DB_MISSING/);
  assert.match(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /DB not found: \$\{/);
});

test("skip-interactions canonical entrypoint redacts private DB provenance only after guarded analysis returns", () => {
  const analysis = entrypoint.indexOf('await import("./analyze-roi-skip-interactions-raw")');
  const redact = entrypoint.lastIndexOf("redactDbProvenance(verifiedDbPath)");

  assert.ok(analysis >= 0);
  assert.ok(redact > analysis, "private DB provenance must be sanitized only after successful guarded analysis");
  assert.match(entrypoint, /const OPAQUE_DB_SOURCE = "primary research database"/u);
  assert.match(entrypoint, /const privateMarker = `DB: \$\{dbPath\}`/u);
  assert.match(entrypoint, /report\.replaceAll\(privateMarker, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/u);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_REPORT_MISSING_AFTER_ANALYSIS/u);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_PRIVATE_DB_PROVENANCE_MARKER_MISSING/u);
});

test("skip-interactions preflight matches the exact forward population and validates settlement line integrity", () => {
  assert.match(audit, /WITH target_rows AS \(/);
  assert.match(audit, /SELECT dh\.race_id, dh\.bet_type, dh\.returned/);
  assert.match(audit, /target_races AS \(\s*SELECT DISTINCT race_id\s*FROM target_rows/);
  assert.match(audit, /dh\.decision = 'BUY'/);
  assert.match(audit, /dh\.run_kind = 'historical-backfill'/);
  assert.match(audit, /dh\.current_odds IS NOT NULL/);
  assert.match(audit, /dh\.selection = '1-2-3'/);
  assert.match(audit, /dh\.date >= \?/);
  assert.match(audit, /EXCLUDED_VENUES/);
  assert.match(audit, /EXCLUDED_RACE_NOS/);
  assert.match(audit, /bet_type = '3連単'/);
  assert.match(audit, /returned = 0/);
  assert.match(audit, /tr\.bet_type IS NULL/);
  assert.match(audit, /tr\.bet_type != '3連単'/);
  assert.match(audit, /tr\.returned IS NULL/);
  assert.match(audit, /tr\.returned != 0/);
  assert.match(audit, /cohortInvalidRows/);
  assert.match(audit, /non-3連単 or returned\/unknown-return historical BUY rows/);
  assert.match(audit, /rp\.bet_type = 'trifecta'/);
  assert.match(audit, /ts\.returned = 0/);
  assert.match(audit, /ts\.returned IS NULL OR ts\.returned != 0/);
  assert.match(audit, /ts\.payout_yen > 0/);
  assert.match(audit, /ts\.payout_yen <= 0/);
  assert.match(audit, /ts\.combination IS NULL/);
  assert.match(audit, /HAVING COUNT\(\*\) > 1/);
  assert.match(audit, /duplicateCombinationKeys/);
  assert.match(audit, /returnedRows/);
  assert.match(audit, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(audit, /process\.exit\(2\)/);

  const cohortGuard = audit.indexOf("if ((row.cohortInvalidRows ?? 0) > 0)");
  const completenessGuard = audit.indexOf("if (!result.complete)");
  assert.ok(cohortGuard >= 0 && cohortGuard < completenessGuard, "decision-cohort drift must fail closed before ROI completeness is accepted");
});

test("skip-interactions preflight permits legitimate multi-line winners rather than enforcing one row per race", () => {
  assert.doesNotMatch(audit, /HAVING COUNT\(\*\) = 1/);
  assert.doesNotMatch(audit, /COUNT\(DISTINCT ts\.combination\) = 1/);
});

test("skip-interactions preflight verifies DB identity before read-only SQLite open", () => {
  const verify = audit.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = audit.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0 && open > verify);
  assert.match(audit, /PRAGMA query_only = ON/);
});
