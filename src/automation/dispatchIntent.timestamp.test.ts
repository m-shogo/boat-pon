import assert from "node:assert/strict";
import test from "node:test";
import { isIntentProcessed, isRequestReplay } from "./dispatchIntent";

const validIntentLedger = {
  ledgerSchemaVersion: "processed-intents-v1",
  updatedAt: "2026-08-10T00:00:00Z",
  intentIds: ["INTENT-aaaa"],
  entries: [{
    intentId: "INTENT-aaaa",
    requestId: "REQ-aaaa",
    result: "PASS",
    recordedAt: "2026-08-10T00:00:00Z",
  }],
};

const validRequestLedger = {
  ledgerSchemaVersion: "processed-requests-v1",
  updatedAt: "2026-08-10T00:00:00Z",
  requestIds: ["REQ-aaaa"],
  idempotencyKeys: {
    ["a".repeat(64)]: {
      requestId: "REQ-aaaa",
      result: "PASS",
      recordedAt: "2026-08-10T00:00:00Z",
    },
  },
};

test("processed intent ledger rejects date-only timestamps fail-closed", () => {
  assert.equal(isIntentProcessed(validIntentLedger, "INTENT-bbbb"), false);
  assert.equal(isIntentProcessed({ ...validIntentLedger, updatedAt: "2026-08-10" }, "INTENT-bbbb"), true);
  assert.equal(isIntentProcessed({
    ...validIntentLedger,
    entries: [{ ...validIntentLedger.entries[0], recordedAt: "2026-08-10" }],
  }, "INTENT-bbbb"), true);
});

test("processed request ledger rejects date-only timestamps fail-closed", () => {
  assert.equal(isRequestReplay(validRequestLedger, "REQ-bbbb"), false);
  assert.equal(isRequestReplay({ ...validRequestLedger, updatedAt: "2026-08-10" }, "REQ-bbbb"), true);
  assert.equal(isRequestReplay({
    ...validRequestLedger,
    idempotencyKeys: {
      ["a".repeat(64)]: { ...validRequestLedger.idempotencyKeys["a".repeat(64)], recordedAt: "2026-08-10" },
    },
  }, "REQ-bbbb"), true);
});

test("replay ledgers accept timezone-qualified RFC3339 timestamps", () => {
  const intentLedger = {
    ...validIntentLedger,
    updatedAt: "2026-08-10T09:00:00+09:00",
    entries: [{ ...validIntentLedger.entries[0], recordedAt: "2026-08-10T09:00:00+09:00" }],
  };
  const requestLedger = {
    ...validRequestLedger,
    updatedAt: "2026-08-10T09:00:00+09:00",
    idempotencyKeys: {
      ["a".repeat(64)]: { ...validRequestLedger.idempotencyKeys["a".repeat(64)], recordedAt: "2026-08-10T09:00:00+09:00" },
    },
  };
  assert.equal(isIntentProcessed(intentLedger, "INTENT-bbbb"), false);
  assert.equal(isRequestReplay(requestLedger, "REQ-bbbb"), false);
});
