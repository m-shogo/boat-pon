import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("H011 implied-vs-frequency binds historical exacta rows to canonical source authority", () => {
  const source = readFileSync("scripts/analyze-h011-implied-vs-frequency.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("hao_base"\)/);
  assert.match(source, /HAVING COUNT\(\*\) >= 20/);
});
