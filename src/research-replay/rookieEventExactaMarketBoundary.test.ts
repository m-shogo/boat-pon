import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("rookie-event screen uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-rookie-event-edge.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
});
