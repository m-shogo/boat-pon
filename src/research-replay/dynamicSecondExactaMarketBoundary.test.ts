import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("dynamic second selector builds candidate and price maps from canonical complete exacta markets", () => {
  const source = readFileSync("scripts/analyze-dynamic-second-selector.ts", "utf8");

  assert.ok((source.match(/historicalExactaCanonicalSourcePredicate\("h"\)/g) ?? []).length >= 2);
  assert.ok((source.match(/historicalExactaCompleteMarketPredicate\("h\.race_id"\)/g) ?? []).length >= 2);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
  assert.doesNotMatch(source, /SELECT race_id,combination,odds FROM historical_alternative_odds WHERE bet_type='exacta'/);
});
