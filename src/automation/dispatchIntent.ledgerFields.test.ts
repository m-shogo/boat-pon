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

test("unknown processed-intent fields and metadata drift fail closed", () => {
  assert.equal(isIntentProcessed({ ...intentLedger, hiddenAuthority: true } as any, "INTENT-20260806-new1"), true);
  assert.equal(isIntentProcessed({ ...intentLedger, ledgerSchemaVersion: "processed-intents-v2" } as any, "INTENT-20260806-new1"), true);
  assert.equal(isIntentProcessed({ ...intentLedger, updatedAt: "not-a-time" } as any, "INTENT-20260806-new1"), true);
  assert.equal(isIntentProcessed({
    ...intentLedger,
    entries: [{ ...intentLedger.entries[0], hiddenAuthority: true }],
  } as any, "INTENT-20260806-new1"), true);
});

test("normalized or impossible processed-intent timestamps fail closed", () => {
  for (const recordedAt of [
    "2026-08-06T24:00:00Z",
    "2026-08-06T23:60:00Z",
    "2026-08-06T23:59:60Z",
    "2026-02-30T07:10:30Z",
  ]) {
    assert.equal(isIntentProcessed({
      ...intentLedger,
      entries: [{ ...intentLedger.entries[0], recordedAt }],
    } as any, "INTENT-20260806-new1"), true, recordedAt);
  }
});

test("unknown processed-request fields and metadata drift fail closed", () => {
  assert.equal(isRequestReplay({ ...requestLedger, hiddenAuthority: true } as any, "REQ-20260806-new1"), true);
  assert.equal(isRequestReplay({ ...requestLedger, ledgerSchemaVersion: "processed-requests-v2" } as any, "REQ-20260806-new1"), true);
  assert.equal(isRequestReplay({ ...requestLedger, updatedAt: "not-a-time" } as any, "REQ-20260806-new1"), true);
  assert.throws(() => findIdempotentSuccess({
    ...requestLedger,
    idempotencyKeys: { [key]: { ...requestLedger.idempotencyKeys[key], hiddenAuthority: true } },
  } as any, key), /malformed processed request ledger/);
});

test("normalized or impossible processed-request timestamps fail closed", () => {
  for (const recordedAt of [
    "2026-08-06T24:00:00Z",
    "2026-08-06T23:60:00Z",
    "2026-08-06T23:59:60Z",
    "2026-02-30T07:10:30Z",
  ]) {
    const malformed = {
      ...requestLedger,
      idempotencyKeys: {
        [key]: { ...requestLedger.idempotencyKeys[key], recordedAt },
      },
    };
    assert.equal(isRequestReplay(malformed as any, "REQ-20260806-new1"), true, recordedAt);
    assert.throws(() => findIdempotentSuccess(malformed as any, key), /malformed processed request ledger/, recordedAt);
  }
});

test("duplicate request provenance across idempotency keys fails closed", () => {
  const duplicateKey = "b".repeat(64);
  const duplicateProvenance = {
    ...requestLedger,
    idempotencyKeys: {
      ...requestLedger.idempotencyKeys,
      [duplicateKey]: {
        ...requestLedger.idempotencyKeys[key],
        result: "BLOCKED",
      },
    },
  };
  assert.equal(isRequestReplay(duplicateProvenance as any, "REQ-20260806-new1"), true);
  assert.throws(() => findIdempotentSuccess(duplicateProvenance as any, duplicateKey), /duplicate requestId provenance/);
  assert.throws(() => assertReplayLedgersConsistent(intentLedger, duplicateProvenance as any), /duplicate requestId provenance/);
});

test("processed intent result must match canonical request provenance when present", () => {
  const conflictingIntent = {
    ...intentLedger,
    entries: [{ ...intentLedger.entries[0], result: "BLOCKED" }],
  };
  assert.throws(
    () => assertReplayLedgersConsistent(conflictingIntent as any, requestLedger),
    /result differs from request provenance/,
  );
});

test("idempotent reuse request without its own provenance entry remains valid", () => {
  const reusedIntentLedger = {
    ...intentLedger,
    intentIds: [...intentLedger.intentIds, "INTENT-20260806-reuse2"],
    entries: [
      ...intentLedger.entries,
      {
        intentId: "INTENT-20260806-reuse2",
        requestId: "REQ-20260806-reuse2",
        result: "PASS",
        recordedAt: "2026-08-06T07:11:00.000Z",
      },
    ],
  };
  const reusedRequestLedger = {
    ...requestLedger,
    requestIds: [...requestLedger.requestIds, "REQ-20260806-reuse2"],
  };
  assert.doesNotThrow(() => assertReplayLedgersConsistent(reusedIntentLedger, reusedRequestLedger));
});
