import assert from "node:assert/strict";
import test from "node:test";
import { isCanonicalT5MarketCoverageSettlement } from "./t5MarketCoverageSettlement";

const expectedProgramDate = "2026-06-01";

test("T-5 market coverage counts only canonical same-date non-returned results as settled", () => {
  assert.equal(isCanonicalT5MarketCoverageSettlement({ date: expectedProgramDate, returned: 0, trifecta: "1-2-3" }, expectedProgramDate), true);
  assert.equal(isCanonicalT5MarketCoverageSettlement({ date: "2026-06-02", returned: 0, trifecta: "1-2-3" }, expectedProgramDate), false);
  assert.equal(isCanonicalT5MarketCoverageSettlement({ date: expectedProgramDate, returned: 1, trifecta: "1-2-3" }, expectedProgramDate), false);
  assert.equal(isCanonicalT5MarketCoverageSettlement({ date: expectedProgramDate, returned: 0, trifecta: null }, expectedProgramDate), false);
  assert.equal(isCanonicalT5MarketCoverageSettlement({ date: expectedProgramDate, returned: 0, trifecta: "9-9-9" }, expectedProgramDate), false);
  assert.equal(isCanonicalT5MarketCoverageSettlement({ date: expectedProgramDate, returned: 0, trifecta: "1-1-2" }, expectedProgramDate), false);
});
