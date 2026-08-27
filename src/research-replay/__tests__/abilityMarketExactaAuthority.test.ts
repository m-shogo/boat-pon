import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ability market validation uses canonical exacta authority for race and odds queries", () => {
  const source = readFileSync("scripts/analyze-ability-market-validation.ts", "utf8");

  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.equal((source.match(/historicalExactaCanonicalSourcePredicate\("h"\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\) = 30/);
});
