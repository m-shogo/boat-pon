import assert from "node:assert/strict";
import test from "node:test";
import { INTENT_SUPERSESSION_SCHEMA_VERSION, type IntentSupersession } from "./intentSupersession";
import { checkSupersessionLedgerIsolation } from "./supersessionLedger";

function supersession(overrides: Partial<IntentSupersession> = {}): IntentSupersession {
  return {
    supersessionSchemaVersion: INTENT_SUPERSESSION_SCHEMA_VERSION,
    supersessionId: "SUPERSESSION-20260805-n2-010-ledger123",
    taskId: "TASK-N2-010",
    replacementIntentId: "INTENT-20260805-replacement123",
    supersededIntents: [{
      intentId: "INTENT-20260805-stale123456",
      expectedAuthoritySha: "1184fa4",
      reason: "AUTHORITY_SHA_MISMATCH",
    }],
    observedAuthoritySha: "00c6f4bcf891e00d0f8b6ffdb11727ca626b30b1",
    createdAt: "2026-08-05T08:41:00.000Z",
    requestedBy: "chatgpt-interactive",
    ...overrides,
  };
}

test("superseded intents stay outside the processed ledger", () => {
  const result = checkSupersessionLedgerIsolation({
    processedIntentIds: ["INTENT-20260805-replacement123"],
    supersessions: [supersession()],
  });
  assert.deepEqual(result.processedSupersededIntentIds, []);
});

test("processed superseded intent is reported fail-closed", () => {
  const result = checkSupersessionLedgerIsolation({
    processedIntentIds: ["INTENT-20260805-stale123456"],
    supersessions: [supersession()],
  });
  assert.deepEqual(result.processedSupersededIntentIds, ["INTENT-20260805-stale123456"]);
});

test("duplicate supersession references are deduplicated and sorted", () => {
  const second = supersession({
    supersessionId: "SUPERSESSION-20260805-n2-010-ledger456",
    supersededIntents: [
      { intentId: "INTENT-20260805-z-stale123", expectedAuthoritySha: "1184fa4", reason: "AUTHORITY_SHA_MISMATCH" },
      { intentId: "INTENT-20260805-stale123456", expectedAuthoritySha: "1184fa4", reason: "AUTHORITY_SHA_MISMATCH" },
    ],
  });
  const result = checkSupersessionLedgerIsolation({
    processedIntentIds: ["INTENT-20260805-z-stale123", "INTENT-20260805-stale123456"],
    supersessions: [supersession(), second],
  });
  assert.deepEqual(result.processedSupersededIntentIds, [
    "INTENT-20260805-stale123456",
    "INTENT-20260805-z-stale123",
  ]);
});
