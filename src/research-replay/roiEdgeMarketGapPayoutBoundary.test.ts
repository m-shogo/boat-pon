import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypointSource = readFileSync("scripts/analyze-roi-edge-market-gap.ts", "utf-8");
const rawSource = readFileSync("scripts/analyze-roi-edge-market-gap-raw.ts", "utf-8");
const dbBoundarySource = readFileSync("scripts/assert-roi-edge-market-gap-db-boundary.ts", "utf-8");
const internalSource = readFileSync("scripts/analyze-roi-edge-market-gap-internal.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-roi-edge-market-gap-payout-completeness.ts", "utf-8");
const packageSource = readFileSync("package.json", "utf-8");

test("ROI edge market-gap normal entrypoint fails closed before internal analysis", () => {
  const preflight = entrypointSource.indexOf('run("scripts/audit-roi-edge-market-gap-payout-completeness.ts")');
  const dbBoundary = entrypointSource.indexOf('await import("./assert-roi-edge-market-gap-db-boundary")');
  const childDbIdentity = entrypointSource.indexOf("ROI_EDGE_MARKET_GAP_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const analysis = entrypointSource.indexOf('await import("./analyze-roi-edge-market-gap-internal")');
  assert.ok(preflight >= 0);
  assert.ok(dbBoundary > preflight);
  assert.ok(childDbIdentity > dbBoundary);
  assert.ok(analysis > childDbIdentity);
  assert.match(entrypointSource, /if \(preflight !== 0\)/);
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
  assert.match(entrypointSource, /assertCanonicalSingleLinkRegularFile/);
  assert.match(entrypointSource, /process\.env\.BOAT_PON_DB_PATH = childDbPath/);
  assert.doesNotMatch(entrypointSource, /analyze-roi-edge-market-gap-raw/);
});

test("ROI edge market-gap raw compatibility module cannot bypass canonical preflight", () => {
  assert.match(rawSource, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(rawSource, /process\.argv\[1\]/);
  assert.match(rawSource, /ROI_EDGE_MARKET_GAP_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(rawSource, /await import\("\.\/analyze-roi-edge-market-gap"\)/);
  assert.doesNotMatch(rawSource, /assert-roi-edge-market-gap-db-boundary/);
  assert.doesNotMatch(rawSource, /analyze-roi-edge-market-gap-internal/);
  assert.doesNotMatch(rawSource, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(rawSource, /new DatabaseSync/);
});

test("ROI edge market-gap guarded path canonicalizes its DB identity without exposing the configured path", () => {
  assert.match(dbBoundarySource, /ROI_EDGE_MARKET_GAP_PRIMARY_DB_MISSING/);
  assert.match(dbBoundarySource, /assertCanonicalSingleLinkRegularFile/);
  assert.match(dbBoundarySource, /ROI_EDGE_MARKET_GAP_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(dbBoundarySource, /process\.env\.BOAT_PON_DB_PATH = verifiedDbPath/);
  assert.doesNotMatch(dbBoundarySource, /DB not found:/);
  assert.doesNotMatch(dbBoundarySource, /`[^`]*\$\{configuredDbPath\}[^`]*`/);
});

test("ROI edge market-gap payout preflight matches analyzer population and stays read-only", () => {
  assert.match(auditSource, /SELECT dh\.race_id, dh\.bet_type, dh\.returned/);
  assert.match(auditSource, /dh\.decision = 'BUY'/);
  assert.match(auditSource, /dh\.run_kind = 'historical-backfill'/);
  assert.match(auditSource, /dh\.result IS NOT NULL/);
  assert.match(auditSource, /dh\.current_odds IS NOT NULL/);
  assert.match(auditSource, /dh\.selection = '1-2-3'/);
  assert.match(auditSource, /dh\.date >= \?/);
  assert.match(auditSource, /bet_type = '3連単'/);
  assert.match(auditSource, /returned = 0/);
  assert.match(auditSource, /rp\.bet_type = 'trifecta'/);
  assert.match(auditSource, /ts\.returned = 0/);
  assert.match(auditSource, /ts\.payout_yen > 0/);
  assert.match(auditSource, /readOnly: true/);
  assert.match(auditSource, /PRAGMA query_only = ON/);
  assert.match(auditSource, /assertCanonicalSingleLinkRegularFile/);
  assert.match(auditSource, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(auditSource, /ROI_EDGE_MARKET_GAP_TRIFECTA_PAYOUT_COVERAGE_INCOMPLETE/);
});

test("ROI edge market-gap preflight fails closed on decision cohort drift before payout verdicts", () => {
  assert.match(auditSource, /tr\.bet_type IS NULL/);
  assert.match(auditSource, /tr\.bet_type != '3連単'/);
  assert.match(auditSource, /tr\.returned IS NULL/);
  assert.match(auditSource, /tr\.returned != 0/);
  assert.match(auditSource, /cohortInvalidRows/);
  assert.match(auditSource, /non-3連単 or returned\/unknown-return historical BUY rows/);
  assert.match(auditSource, /process\.exit\(2\)/);
});

test("ROI edge market-gap settlement gate permits legitimate multi-line races but rejects ambiguous or unknown-return lines", () => {
  assert.match(auditSource, /target_settlements/);
  assert.match(auditSource, /GROUP BY race_id, combination/);
  assert.match(auditSource, /HAVING COUNT\(\*\) > 1/);
  assert.match(auditSource, /duplicateCombinationKeys/);
  assert.match(auditSource, /invalidNonRefundRows/);
  assert.match(auditSource, /returnedRows/);
  assert.match(auditSource, /ts\.returned IS NULL OR ts\.returned != 0/);
  assert.match(auditSource, /refund or unknown-return settlement rows/);
  assert.match(auditSource, /ts\.combination IS NULL/);
  assert.match(auditSource, /ts\.combination = ''/);
  assert.match(auditSource, /ts\.payout_yen IS NULL/);
  assert.match(auditSource, /ts\.payout_yen <= 0/);
  assert.doesNotMatch(auditSource, /HAVING COUNT\(\*\) = 1/);
});

test("ROI edge market-gap internal analyzer retains both payout-dependent combinations", () => {
  assert.match(internalSource, /combination='1-2-3'/);
  assert.match(internalSource, /combination='1-3-2'/);
  assert.match(internalSource, /COALESCE/);
  assert.match(internalSource, /roi132loss/);
  assert.match(internalSource, /deriveVerdict/);
});

test("ROI edge market-gap npm command stays on the fail-closed normal entrypoint", () => {
  assert.match(packageSource, /"analyze:roi-edge-market-gap": "tsx scripts\/analyze-roi-edge-market-gap\.ts"/);
});
