import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("same-day rhythm screen binds both base and selection odds to canonical exacta authority", () => {
  const source = readFileSync("scripts/analyze-same-day-rhythm-market.ts", "utf8");

  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.equal((source.match(/historicalExactaCanonicalSourcePredicate\("h"\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
});
