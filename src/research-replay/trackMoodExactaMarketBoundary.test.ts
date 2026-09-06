import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("track mood market uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-track-mood-market.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /COUNT\(\*\) FROM historical_alternative_odds a WHERE a\.race_id=h\.race_id AND a\.bet_type='exacta'\)\s*=\s*30/);
});

test("track mood ROI fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-track-mood-market.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(oddsByRace\)/);
  assert.match(source, /TRACK_MOOD_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /map\(requiredPayout\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});
