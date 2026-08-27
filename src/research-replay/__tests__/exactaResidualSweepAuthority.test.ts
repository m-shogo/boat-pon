import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("exacta residual sweep binds both market queries to canonical source and complete-market authority", () => {
  const source = readFileSync("scripts/analyze-exacta-market-residual-sweep.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("hao"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.equal(
    source.match(/historicalExactaCanonicalSourcePredicate\("hao"\)/g)?.length,
    2,
    "both the race-level overround query and combo odds query must use canonical exacta source authority",
  );
  assert.match(
    source,
    /HAVING \$\{HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING\} AND COALESCE\(is_f, 0\) = 0/,
  );
});
