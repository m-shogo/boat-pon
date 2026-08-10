import assert from "node:assert/strict";
import test from "node:test";
import { INTENT_SCHEMA_VERSION, type DispatchIntent } from "./dispatchIntent";
import {
  INTENT_SUPERSESSION_SCHEMA_VERSION,
  analyzeEquivalentUnprocessedIntents,
  type IntentSupersession,
} from "./intentSupersession";

const currentAuthority = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function intent(overrides: Partial<DispatchIntent>): DispatchIntent {
  return {
    intentSchemaVersion: INTENT_SCHEMA_VERSION,
    intentId: "INTENT-20260811-current1",
    taskId: "TASK-N2-010",
    requestedAction: "run-task",
    safetyLevel: "L2",
    expectedAuthoritySha: "bbbbbbb",
    maxDurationSeconds: 1800,
    requestedBy: "test",
    requestReference: "REQ-20260811-current1",
    ...overrides,
  };
}

function supersession(replacementIntentId: string, old: DispatchIntent): IntentSupersession {
  return {
    supersessionSchemaVersion: INTENT_SUPERSESSION_SCHEMA_VERSION,
    supersessionId: "SUPERSESSION-20260811-semantic1",
    taskId: old.taskId,
    replacementIntentId,
    supersededIntents: [{
      intentId: old.intentId,
      expectedAuthoritySha: old.expectedAuthoritySha,
      reason: "AUTHORITY_SHA_MISMATCH",
    }],
    observedAuthoritySha: currentAuthority,
    createdAt: "2026-08-11T00:00:00.000Z",
    requestedBy: "test",
  };
}

function analyze(old: DispatchIntent, replacement: DispatchIntent) {
  return analyzeEquivalentUnprocessedIntents({
    currentIntent: replacement,
    allIntents: [old, replacement],
    processedIntentIds: [],
    supersessions: [supersession(replacement.intentId, old)],
    acceptableAuthorityShas: [currentAuthority],
  });
}

test("authority-only supersession cannot change safety level", () => {
  const old = intent({ intentId: "INTENT-20260810-old-safe1", expectedAuthoritySha: "aaaaaaa", safetyLevel: "L1" });
  const replacement = intent({ safetyLevel: "L2" });
  const result = analyze(old, replacement);
  assert.deepEqual(result.blockingIntentIds, [old.intentId]);
  assert.deepEqual(result.supersededIntentIds, []);
});

test("authority-only supersession cannot change duration or approval grant", () => {
  const old = intent({
    intentId: "INTENT-20260810-old-grant1",
    expectedAuthoritySha: "aaaaaaa",
    safetyLevel: "L3",
    approvalGrantId: "GRANT-A",
    maxDurationSeconds: 1200,
  });
  const replacement = intent({
    safetyLevel: "L3",
    approvalGrantId: "GRANT-B",
    maxDurationSeconds: 1800,
  });
  const result = analyze(old, replacement);
  assert.deepEqual(result.blockingIntentIds, [old.intentId]);
  assert.deepEqual(result.supersededIntentIds, []);
});
