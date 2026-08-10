import assert from "node:assert/strict";
import test from "node:test";
import { isIntentProcessed } from "./dispatchIntent";

test("processed intent ledger rejects reordered append history", () => {
  const first = {
    intentId: "INTENT-20260810-a",
    requestId: "REQ-20260810-a",
    result: "PASS",
    recordedAt: "2026-08-10T08:00:00.000Z",
  };
  const second = {
    intentId: "INTENT-20260810-b",
    requestId: "REQ-20260810-b",
    result: "PASS",
    recordedAt: "2026-08-10T08:01:00.000Z",
  };

  const aligned = {
    intentIds: [first.intentId, second.intentId],
    entries: [first, second],
  };
  assert.equal(isIntentProcessed(aligned, "INTENT-20260810-c"), false);

  const reordered = {
    intentIds: [first.intentId, second.intentId],
    entries: [second, first],
  };
  assert.equal(isIntentProcessed(reordered, "INTENT-20260810-c"), true);
});
