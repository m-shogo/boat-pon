import assert from "node:assert/strict";
import test from "node:test";
import { QUEUE_STATE_SCHEMA_VERSION, validateQueueState } from "./taskCatalog";

function task(over: Record<string, unknown> = {}) {
  return {
    status: "READY",
    taskDefinitionVersion: 1,
    authoritySha: null,
    attemptCount: 0,
    maxAttempts: 3,
    evidenceLinks: [],
    resultDigest: null,
    lastFailure: null,
    checkpoint: null,
    updatedAt: "2026-08-10T00:00:00Z",
    ...over,
  };
}

function queue(over: Record<string, unknown> = {}) {
  return {
    stateSchemaVersion: QUEUE_STATE_SCHEMA_VERSION,
    stateVersion: 1,
    catalogVersion: "v1",
    updatedAt: "2026-08-10T00:00:00Z",
    tasks: { "TASK-N2-001": task() },
    ...over,
  };
}

test("queue authority timestamps reject impossible Gregorian calendar dates", () => {
  for (const updatedAt of [
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-04-31T00:00:00+09:00",
    "2026-13-01T00:00:00Z",
  ]) {
    assert.equal(validateQueueState(queue({ updatedAt })).valid, false, `queue ${updatedAt}`);
    assert.equal(validateQueueState(queue({ tasks: { "TASK-N2-001": task({ updatedAt }) } })).valid, false, `task ${updatedAt}`);
    assert.equal(validateQueueState(queue({ tasks: { "TASK-N2-001": task({
      lastFailure: { code: "EXECUTOR_EXCEPTION", at: updatedAt, message: "boom" },
    }) } })).valid, false, `failure ${updatedAt}`);
  }
});

test("queue authority timestamps preserve valid leap-day offsets", () => {
  const leapDay = "2028-02-29T10:38:22+09:00";
  assert.equal(validateQueueState(queue({ updatedAt: leapDay })).valid, true);
  assert.equal(validateQueueState(queue({ tasks: { "TASK-N2-001": task({ updatedAt: leapDay }) } })).valid, true);
  assert.equal(validateQueueState(queue({ tasks: { "TASK-N2-001": task({
    lastFailure: { code: "EXECUTOR_EXCEPTION", at: leapDay, message: "boom" },
  }) } })).valid, true);
});
