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
