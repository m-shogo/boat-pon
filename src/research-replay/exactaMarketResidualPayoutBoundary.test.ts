import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("exacta residual payout audit mirrors the canonical complete no-F population", () => {
  const source = readFileSync("scripts/audit-exacta-market-residual-payout-completeness.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("hao"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.match(source, /status_code = 'F'/);
  assert.match(source, /bet_type = 'exacta'/);
});

test("exacta residual payout audit is read-only and fails closed on incomplete settlement", () => {
  const source = readFileSync("scripts/audit-exacta-market-residual-payout-completeness.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /payout_yen IS NOT NULL AND rp\.payout_yen > 0/);
  assert.match(source, /EXACTA_MARKET_RESIDUAL_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /total <= 0/);
  assert.match(source, /settled !== total/);
});

test("exacta residual payout audit requires one canonical winning settlement per race", () => {
  const source = readFileSync("scripts/audit-exacta-market-residual-payout-completeness.ts", "utf8");

  assert.match(source, /WHEN COUNT\(\*\) = 1/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("winner_hao"\)/);
  assert.match(source, /winner_hao\.combination = rp\.combination/);
  assert.match(source, /SUM\(CASE WHEN rp\.payout_yen IS NOT NULL AND rp\.payout_yen > 0 THEN 1 ELSE 0 END\) = 1/);
});

test("safe exacta residual runner never starts analysis before payout audit passes", () => {
  const source = readFileSync("scripts/run-exacta-market-residual-sweep-safe.ts", "utf8");
  const auditIndex = source.indexOf("audit-exacta-market-residual-payout-completeness.ts");
  const analysisIndex = source.indexOf("analyze-exacta-market-residual-sweep.ts");
  const statusGateIndex = source.indexOf("audit.status !== 0");

  assert.ok(auditIndex >= 0);
  assert.ok(statusGateIndex > auditIndex);
  assert.ok(analysisIndex > statusGateIndex);
});
