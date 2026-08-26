import assert from "node:assert/strict";
import test from "node:test";
import { isCanonicalT5TrifectaResult } from "./t5MarketBaselineResult";

test("t5 market baseline result accepts canonical trifecta winners", () => {
  assert.equal(isCanonicalT5TrifectaResult("1-2-3"), true);
  assert.equal(isCanonicalT5TrifectaResult("6-5-4"), true);
});

test("t5 market baseline result rejects producer-impossible winners", () => {
  for (const value of ["9-9-9", "1-1-2", "0-1-2", "1-2", "1-2-03", "1-2-X"]) {
    assert.equal(isCanonicalT5TrifectaResult(value), false, value);
  }
});
