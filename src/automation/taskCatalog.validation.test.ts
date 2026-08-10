import assert from "node:assert/strict";
import test from "node:test";
import { QUEUE_STATE_SCHEMA_VERSION, validateQueueState } from "./taskCatalog";

function queue(task: unknown) {
  return {
    stateSchemaVersion: QUEUE_STATE_SCHEMA_VERSION,
    stateVersion: 1,
    catalogVersion: "v1",
    updatedAt: "2026-08-10T00:00:00Z",
    tasks: { "TASK-N2-001": task },
  };
}

function validTask(over: Record<string, unknown> = {}) {
  return {
    status: "READY",
    taskDefinitionVersion: 1,
    attemptCount: 0,
    maxAttempts: 3,
    ...over,
  };
}

test("queue state accepts valid task execution bounds", () => {
  assert.equal(validateQueueState(queue(validTask())).valid, true);
});

test("queue state rejects non-object task entries", () => {
  assert.equal(validateQueueState(queue(null)).valid, false);
  assert.equal(validateQueueState(queue([])).valid, false);
});

test("queue state rejects invalid task definition versions", () => {
  assert.equal(validateQueueState(queue(validTask({ taskDefinitionVersion: 0 }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ taskDefinitionVersion: 1.5 }))).valid, false);
});

test("queue state rejects invalid attempt ceilings", () => {
  assert.equal(validateQueueState(queue(validTask({ maxAttempts: 0 }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ maxAttempts: 1.5 }))).valid, false);
});

test("queue state rejects attemptCount above maxAttempts", () => {
  assert.equal(validateQueueState(queue(validTask({ attemptCount: 4, maxAttempts: 3 }))).valid, false);
});
