import assert from "node:assert/strict";
import test from "node:test";
import { isCanonicalT5MarketCoverageSettlement } from "./t5MarketCoverageSettlement";

test("T-5 market coverage counts only canonical non-returned results as settled", () => {
  assert.equal(isCanonicalT5MarketCoverageSettlement({ returned: 0, trifecta: "1-2-3" }), true);
  assert.equal(isCanonicalT5MarketCoverageSettlement({ returned: 1, trifecta: "1-2-3" }), false);
  assert.equal(isCanonicalT5MarketCoverageSettlement({ returned: 0, trifecta: null }), false);
  assert.equal(isCanonicalT5MarketCoverageSettlement({ returned: 0, trifecta: "9-9-9" }), false);
  assert.equal(isCanonicalT5MarketCoverageSettlement({ returned: 0, trifecta: "1-1-2" }), false);
});
