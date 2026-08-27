import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("racer relationship market screen uses canonical historical exacta authority", () => {
  const source = readFileSync("scripts/analyze-racer-relationship-market.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
});
