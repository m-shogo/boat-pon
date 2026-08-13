import assert from "node:assert/strict";
import test from "node:test";
import { isIntentProcessed, isRequestReplay } from "./dispatchIntent";

const intentLedger = {
  ledgerSchemaVersion: "processed-intents-v1",
  updatedAt: "2028-02-29T09:00:00+09:00",
  intentIds: ["INTENT-aaaa"],
  entries: [{
    intentId: "INTENT-aaaa",
    requestId: "REQ-aaaa",
    result: "PASS",
    recordedAt: "2028-02-29T09:00:00+09:00",
  }],
};

const requestLedger = {
  ledgerSchemaVersion: "processed-requests-v1",
  updatedAt: "2028-02-29T09:00:00+09:00",
  requestIds: ["REQ-aaaa"],
  idempotencyKeys: {
    ["a".repeat(64)]: {
      requestId: "REQ-aaaa",
      result: "PASS",
      recordedAt: "2028-02-29T09:00:00+09:00",
    },
  },
};

test("processed replay ledgers reject impossible calendar timestamps fail-closed", () => {
  assert.equal(isIntentProcessed(intentLedger, "INTENT-bbbb"), false);
  assert.equal(isRequestReplay(requestLedger, "REQ-bbbb"), false);

  assert.equal(isIntentProcessed({ ...intentLedger, updatedAt: "2026-02-30T00:00:00Z" } as any, "INTENT-bbbb"), true);
  assert.equal(isIntentProcessed({
    ...intentLedger,
    entries: [{ ...intentLedger.entries[0], recordedAt: "2026-04-31T09:00:00+09:00" }],
  } as any, "INTENT-bbbb"), true);

  assert.equal(isRequestReplay({ ...requestLedger, updatedAt: "2026-02-29T00:00:00Z" }, "REQ-bbbb"), true);
  assert.equal(isRequestReplay({
    ...requestLedger,
    idempotencyKeys: {
      ["a".repeat(64)]: { ...requestLedger.idempotencyKeys["a".repeat(64)], recordedAt: "2026-04-31T09:00:00+09:00" },
    },
  }, "REQ-bbbb"), true);
});
