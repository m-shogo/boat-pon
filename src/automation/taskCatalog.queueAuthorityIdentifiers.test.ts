import assert from "node:assert/strict";
import test from "node:test";
import { QUEUE_STATE_SCHEMA_VERSION, validateQueueState } from "./taskCatalog";

function queue(task: Record<string, unknown>) {
  return {
    stateSchemaVersion: QUEUE_STATE_SCHEMA_VERSION,
    stateVersion: 51,
    catalogVersion: "2026-08-06-n2-governance-v8",
    updatedAt: "2026-08-11T03:05:00.000Z",
    tasks: { "TASK-N2-011": task },
  };
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    status: "PASS",
    taskDefinitionVersion: 4,
    authoritySha: "e8edb830af8c26a76d36f4c5f7802847b2e757af",
    attemptCount: 3,
    maxAttempts: 3,
    evidenceLinks: [],
    resultDigest: "d790d904bfe75983e3bf3ff94e20ade81463becd34a8f0fbc2be16f92c25144c",
    lastFailure: null,
    checkpoint: null,
    updatedAt: "2026-08-11T03:05:00.000Z",
    ...overrides,
  };
}

test("queue validator accepts canonical authority SHA and result digest", () => {
  assert.equal(validateQueueState(queue(task())).valid, true);
  assert.equal(validateQueueState(queue(task({ authoritySha: null, resultDigest: null }))).valid, true);
  assert.equal(validateQueueState(queue(task({ authoritySha: "e8edb83" }))).valid, true);
});

test("queue validator rejects malformed authority SHA", () => {
  for (const authoritySha of ["", "xyz1234", "a".repeat(6), "a".repeat(41), 42]) {
    assert.equal(validateQueueState(queue(task({ authoritySha }))).valid, false);
  }
});

test("queue validator rejects malformed result digest", () => {
  for (const resultDigest of ["", "g".repeat(64), "a".repeat(63), "a".repeat(65), 42]) {
    assert.equal(validateQueueState(queue(task({ resultDigest }))).valid, false);
  }
});
