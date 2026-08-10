import assert from "node:assert/strict";
import test from "node:test";
import { isIntentProcessed, isRequestReplay } from "./dispatchIntent";

test("missing replay ledgers fail closed", () => {
  assert.equal(isIntentProcessed(null, "INTENT-20260810-missing"), true);
  assert.equal(isRequestReplay(null, "REQ-20260810-missing"), true);
});
