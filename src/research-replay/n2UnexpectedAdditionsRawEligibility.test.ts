import assert from "node:assert/strict";
import test from "node:test";
import { isUnexpectedAdditionsRawEligible } from "./n2UnexpectedAdditionsRawEligibility";

test("unexpected additions audit accepts only replay-eligible verified raw evidence", () => {
  assert.equal(isUnexpectedAdditionsRawEligible({
    integrityStatus: "verified",
    securityScanStatus: "passed",
    parserReplayEligible: 1,
  }), true);

  for (const row of [
    { integrityStatus: "quarantined", securityScanStatus: "passed", parserReplayEligible: 1 },
    { integrityStatus: "verified", securityScanStatus: "failed", parserReplayEligible: 1 },
    { integrityStatus: "verified", securityScanStatus: "passed", parserReplayEligible: 0 },
  ]) {
    assert.equal(isUnexpectedAdditionsRawEligible(row), false);
  }
});
