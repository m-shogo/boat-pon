import assert from "node:assert/strict";
import test from "node:test";
import { assertReplayLedgersConsistent, findIdempotentSuccess, isIntentProcessed, isRequestReplay } from "./dispatchIntent";

const intentLedger = {
  ledgerSchemaVersion: "processed-intents-v1",
  updatedAt: "2026-08-06T07:10:30.991Z",
  intentIds: ["INTENT-20260806-safe1"],
  entries: [{
    intentId: "INTENT-20260806-safe1",
    requestId: "REQ-20260806-safe1",
    result: "PASS",
    recordedAt: "2026-08-06T07:10:30.991Z",
  }],
};

const key = "a".repeat(64);
const requestLedger = {
  ledgerSchemaVersion: "processed-requests-v1",
  updatedAt: "2026-08-06T07:10:30.992Z",
  requestIds: ["REQ-20260806-safe1"],
  idempotencyKeys: {
    [key]: {
      requestId: "REQ-20260806-safe1",
      result: "PASS",
      evidencePath: "reports/automation/history/31079861762-TASK-N2-011.json",
      recordedAt: "2026-08-06T07:10:30.992Z",
    },
  },
};

test("canonical replay ledger field sets remain valid", () => {
  assert.doesNotThrow(() => assertReplayLedgersConsistent(intentLedger, requestLedger));
  assert.equal(isIntentProcessed(intentLedger, "INTENT-20260806-new1"), false);
  assert.equal(isRequestReplay(requestLedger, "REQ-20260806-new1"), false);
  assert.equal(findIdempotentSuccess(requestLedger, key)?.requestId, "REQ-20260806-safe1");
});

test("unknown processed-intent fields fail closed", () => {
  assert.equal(isIntentProcessed({ ...intentLedger, hiddenAuthority: true } as any, "INTENT-20260806-new1"), true);
  assert.equal(isIntentProcessed({
    ...intentLedger,
    entries: [{ ...intentLedger.entries[0], hiddenAuthority: true }],
  } as any, "INTENT-20260806-new1"), true);
});

test("unknown processed-request fields fail closed", () => {
  assert.equal(isRequestReplay({ ...requestLedger, hiddenAuthority: true } as any, "REQ-20260806-new1"), true);
  assert.throws(() => findIdempotentSuccess({
    ...requestLedger,
    idempotencyKeys: { [key]: { ...requestLedger.idempotencyKeys[key], hiddenAuthority: true } },
  } as any, key), /malformed processed request ledger/);
});
