import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("event selection matrix uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-event-selection-matrix.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /COUNT\(\*\) FROM historical_alternative_odds all_odds WHERE all_odds\.race_id=h\.race_id AND all_odds\.bet_type='exacta'\)\s*=\s*30/);
});
