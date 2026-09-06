import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("market microstructure uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-market-microstructure.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.doesNotMatch(source, /COUNT\(\*\) FROM historical_alternative_odds a WHERE a\.race_id=h\.race_id AND a\.bet_type='exacta'\)\s*=\s*30/);
});

test("market microstructure ROI fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-market-microstructure.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(byRace\)/);
  assert.match(source, /MARKET_MICROSTRUCTURE_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /payout:requiredPayout\(source\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});
