import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("market attention uses canonical exacta authority for odds and overround", () => {
  const source = readFileSync("scripts/analyze-market-attention.ts", "utf8");

  assert.match(source, /historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\(\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
});

test("market attention ROI fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-market-attention.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(odds\)/);
  assert.match(source, /MARKET_ATTENTION_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /requiredPayout\(row\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});

test("market attention preflights scalar exacta settlement integrity before evaluating schedule effects", () => {
  const source = readFileSync("scripts/analyze-market-attention.ts", "utf8");
  const preflight = source.indexOf("assertSettlementCoverage(coverage)");
  const analysis = source.indexOf("const odds=db.prepare");

  assert.ok(preflight >= 0 && analysis > preflight, "settlement integrity must pass before attention aggregation");
  assert.match(source, /CASE WHEN COUNT\(\*\)=1/);
  assert.match(source, /MARKET_ATTENTION_EXACTA_SETTLEMENT_INTEGRITY_INVALID/);
  assert.match(source, /JOIN race_payouts p ON p\.race_id=h\.race_id AND p\.bet_type='exacta'/);
  assert.match(source, /SELECT COUNT\(\*\) FROM race_payouts rp WHERE rp\.race_id=h\.race_id AND rp\.bet_type='exacta'\)=1/);
  assert.match(source, /p\.returned=0/);
  assert.match(source, /p\.combination IS NOT NULL AND trim\(p\.combination\)!=''/);
  assert.match(source, /p\.payout_yen IS NOT NULL AND p\.payout_yen>0/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("winner_h"\)/);
  assert.match(source, /winner_h\.combination=p\.combination/);
  assert.doesNotMatch(source, /LEFT JOIN race_payouts p/);
});
