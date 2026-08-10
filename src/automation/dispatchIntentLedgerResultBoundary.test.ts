import assert from "node:assert/strict";
import test from "node:test";
import { findIdempotentSuccess, isIntentProcessed } from "./dispatchIntent";

test("processed intent ledger rejects unknown terminal result values", () => {
  const ledger = {
    intentIds: ["INTENT-20260810-a"],
    entries: [{
      intentId: "INTENT-20260810-a",
      requestId: "REQ-20260810-a",
      result: "UNEXPECTED_RESULT",
      recordedAt: "2026-08-10T08:00:00.000Z",
    }],
  };
  assert.equal(isIntentProcessed(ledger, "INTENT-20260810-b"), true);
});

test("processed request idempotency ledger rejects unknown terminal result values", () => {
  const key = "a".repeat(64);
  assert.throws(() => findIdempotentSuccess({
    requestIds: ["REQ-20260810-a"],
    idempotencyKeys: {
      [key]: {
        requestId: "REQ-20260810-a",
        result: "UNEXPECTED_RESULT",
        recordedAt: "2026-08-10T08:00:00.000Z",
      },
    },
  }, key), /malformed processed request ledger/);
});
