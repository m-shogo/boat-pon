import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("market microstructure uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-market-microstructure.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.doesNotMatch(source, /COUNT\(\*\) FROM historical_alternative_odds a WHERE a\.race_id=h\.race_id AND a\.bet_type='exacta'\)\s*=\s*30/);
});
