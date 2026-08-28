import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-skip6r-switch-historical-closing-odds.ts", "utf8");

test("skip6R historical switch uses the shared canonical trifecta market authority", () => {
  assert.match(source, /historicalTrifectaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalTrifectaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source, /h\.bet_type = 'trifecta'/);
  assert.doesNotMatch(source, /WHERE source_quality = 'historical_closing_odds'/);
});
