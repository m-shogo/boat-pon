import assert from "node:assert/strict";
import test from "node:test";
import { INTENT_SCHEMA_VERSION, type DispatchIntent } from "./dispatchIntent";
import {
  INTENT_SUPERSESSION_SCHEMA_VERSION,
  analyzeEquivalentUnprocessedIntents,
  authorityMatches,
  validateIntentSupersession,
  type IntentSupersession,
} from "./intentSupersession";

function intent(overrides: Partial<DispatchIntent> = {}): DispatchIntent {
  return {
    intentSchemaVersion: INTENT_SCHEMA_VERSION,
    intentId: "INTENT-20260805-new1234567",
    taskId: "TASK-N2-010",
    requestedAction: "run-task",
    safetyLevel: "L0",
    expectedAuthoritySha: "00c6f4b",
    maxDurationSeconds: 3600,
    requestedBy: "chatgpt-interactive",
    requestReference: "REQ-20260805-new1234567",
    ...overrides,
  };
}

function supersession(overrides: Partial<IntentSupersession> = {}): IntentSupersession {
  return {
    supersessionSchemaVersion: INTENT_SUPERSESSION_SCHEMA_VERSION,
    supersessionId: "SUPERSESSION-20260805-n2-010-new1234567",
    taskId: "TASK-N2-010",
    replacementIntentId: "INTENT-20260805-new1234567",
    supersededIntents: [{
      intentId: "INTENT-20260805-old1234567",
      expectedAuthoritySha: "1184fa4",
      reason: "AUTHORITY_SHA_MISMATCH",
    }],
    observedAuthoritySha: "00c6f4bcf891e00d0f8b6ffdb11727ca626b30b1",
    createdAt: "2026-08-05T08:41:00.000Z",
    requestedBy: "chatgpt-interactive",
    ...overrides,
  };
}

test("valid supersession passes strict validation", () => {
  const result = validateIntentSupersession(supersession());
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.supersession?.replacementIntentId, "INTENT-20260805-new1234567");
});

test("supersession rejects unknown top-level fields before deeper decoding", () => {
  const result = validateIntentSupersession({ ...supersession(), queueDigest: "forbidden" });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["unknown field: queueDigest"]);
});

test("supersession rejects duplicate entries and replacement self-reference", () => {
  const selfEntry = {
    intentId: "INTENT-20260805-new1234567",
    expectedAuthoritySha: "1184fa4",
    reason: "AUTHORITY_SHA_MISMATCH" as const,
  };
  const result = validateIntentSupersession(supersession({
    supersededIntents: [selfEntry, { ...selfEntry }],
  }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /replacement intent cannot supersede itself/);
  assert.match(result.errors.join("\n"), /duplicate superseded intentId/);
});

test("authority matching supports full and short SHA prefixes", () => {
  const full = "00c6f4bcf891e00d0f8b6ffdb11727ca626b30b1";
  assert.equal(authorityMatches("00c6f4b", [full]), true);
  assert.equal(authorityMatches(full, ["00c6f4b"]), true);
  assert.equal(authorityMatches("1184fa4", [full]), false);
});

test("active equivalent unprocessed intent always blocks", () => {
  const current = intent();
  const activeOld = intent({ intentId: "INTENT-20260805-active12345", expectedAuthoritySha: "00c6f4b" });
  const analysis = analyzeEquivalentUnprocessedIntents({
    currentIntent: current,
    allIntents: [activeOld, current],
    processedIntentIds: [],
    supersessions: [supersession({
      supersededIntents: [{
        intentId: activeOld.intentId,
        expectedAuthoritySha: activeOld.expectedAuthoritySha,
        reason: "AUTHORITY_SHA_MISMATCH",
      }],
    })],
    acceptableAuthorityShas: ["00c6f4bcf891e00d0f8b6ffdb11727ca626b30b1"],
  });
  assert.deepEqual(analysis.blockingIntentIds, [activeOld.intentId]);
  assert.deepEqual(analysis.supersededIntentIds, []);
});

test("stale equivalent intent blocks without a matching supersession", () => {
  const current = intent();
  const staleOld = intent({ intentId: "INTENT-20260805-old1234567", expectedAuthoritySha: "1184fa4" });
  const analysis = analyzeEquivalentUnprocessedIntents({
    currentIntent: current,
    allIntents: [staleOld, current],
    processedIntentIds: [],
    supersessions: [],
    acceptableAuthorityShas: ["00c6f4bcf891e00d0f8b6ffdb11727ca626b30b1"],
  });
  assert.deepEqual(analysis.blockingIntentIds, [staleOld.intentId]);
  assert.deepEqual(analysis.supersededIntentIds, []);
});

test("stale equivalent intent is replaced only by a matching immutable replacement binding", () => {
  const current = intent();
  const staleOld = intent({ intentId: "INTENT-20260805-old1234567", expectedAuthoritySha: "1184fa4" });
  const analysis = analyzeEquivalentUnprocessedIntents({
    currentIntent: current,
    allIntents: [staleOld, current],
    processedIntentIds: [],
    supersessions: [supersession()],
    acceptableAuthorityShas: ["00c6f4bcf891e00d0f8b6ffdb11727ca626b30b1"],
  });
  assert.deepEqual(analysis.blockingIntentIds, []);
  assert.deepEqual(analysis.supersededIntentIds, [staleOld.intentId]);
});

test("supersession remains terminal after main advances and its replacement is processed", () => {
  const old = intent({ intentId: "INTENT-20260805-old1234567", expectedAuthoritySha: "1184fa4" });
  const replacement = intent();
  const future = intent({
    intentId: "INTENT-20260806-future12345",
    expectedAuthoritySha: "bbbbbbb",
    requestReference: "REQ-20260806-future12345",
  });
  const analysis = analyzeEquivalentUnprocessedIntents({
    currentIntent: future,
    allIntents: [old, replacement, future],
    processedIntentIds: [replacement.intentId],
    supersessions: [supersession()],
    acceptableAuthorityShas: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
  });
  assert.deepEqual(analysis.blockingIntentIds, []);
  assert.deepEqual(analysis.supersededIntentIds, [old.intentId]);
});

test("unprocessed stale replacement blocks a later intent even when older intent is terminal", () => {
  const old = intent({ intentId: "INTENT-20260805-old1234567", expectedAuthoritySha: "1184fa4" });
  const replacement = intent();
  const future = intent({
    intentId: "INTENT-20260806-future12345",
    expectedAuthoritySha: "bbbbbbb",
    requestReference: "REQ-20260806-future12345",
  });
  const analysis = analyzeEquivalentUnprocessedIntents({
    currentIntent: future,
    allIntents: [old, replacement, future],
    processedIntentIds: [],
    supersessions: [supersession()],
    acceptableAuthorityShas: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
  });
  assert.deepEqual(analysis.blockingIntentIds, [replacement.intentId]);
  assert.deepEqual(analysis.supersededIntentIds, [old.intentId]);
});

test("processed equivalent intent is ignored", () => {
  const current = intent();
  const old = intent({ intentId: "INTENT-20260805-old1234567", expectedAuthoritySha: "1184fa4" });
  const analysis = analyzeEquivalentUnprocessedIntents({
    currentIntent: current,
    allIntents: [old, current],
    processedIntentIds: [old.intentId],
    supersessions: [],
    acceptableAuthorityShas: ["00c6f4bcf891e00d0f8b6ffdb11727ca626b30b1"],
  });
  assert.deepEqual(analysis, { blockingIntentIds: [], supersededIntentIds: [] });
});

test("supersession whose observed authority does not bind to replacement remains invalid", () => {
  const current = intent();
  const staleOld = intent({ intentId: "INTENT-20260805-old1234567", expectedAuthoritySha: "1184fa4" });
  const analysis = analyzeEquivalentUnprocessedIntents({
    currentIntent: current,
    allIntents: [staleOld, current],
    processedIntentIds: [],
    supersessions: [supersession({ observedAuthoritySha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })],
    acceptableAuthorityShas: ["00c6f4bcf891e00d0f8b6ffdb11727ca626b30b1"],
  });
  assert.deepEqual(analysis.blockingIntentIds, [staleOld.intentId]);
});

test("supersession pointing to a missing replacement remains invalid", () => {
  const current = intent({
    intentId: "INTENT-20260806-future12345",
    expectedAuthoritySha: "bbbbbbb",
    requestReference: "REQ-20260806-future12345",
  });
  const staleOld = intent({ intentId: "INTENT-20260805-old1234567", expectedAuthoritySha: "1184fa4" });
  const analysis = analyzeEquivalentUnprocessedIntents({
    currentIntent: current,
    allIntents: [staleOld, current],
    processedIntentIds: [],
    supersessions: [supersession()],
    acceptableAuthorityShas: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
  });
  assert.deepEqual(analysis.blockingIntentIds, [staleOld.intentId]);
});
