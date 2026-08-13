import assert from "node:assert/strict";
import test from "node:test";
import { QUEUE_STATE_SCHEMA_VERSION, validateQueueState } from "./taskCatalog";

function queue(task: unknown, taskId = "TASK-N2-001") {
  return {
    stateSchemaVersion: QUEUE_STATE_SCHEMA_VERSION,
    stateVersion: 1,
    catalogVersion: "v1",
    updatedAt: "2026-08-10T00:00:00Z",
    tasks: { [taskId]: task },
  };
}

function validTask(over: Record<string, unknown> = {}) {
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

test("queue state accepts valid task execution bounds", () => {
  assert.equal(validateQueueState(queue(validTask())).valid, true);
});

test("queue state requires the complete canonical task-state shape", () => {
  for (const field of ["authoritySha", "evidenceLinks", "resultDigest", "lastFailure", "checkpoint"] as const) {
    const task = validTask() as Record<string, unknown>;
    delete task[field];
    const result = validateQueueState(queue(task));
    assert.equal(result.valid, false, field);
    assert.match(result.errors.join("\n"), new RegExp(`${field} required`));
  }
});

test("queue state rejects invalid authority metadata", () => {
  assert.equal(validateQueueState({ ...queue(validTask()), catalogVersion: "" }).valid, false);
  assert.equal(validateQueueState({ ...queue(validTask()), catalogVersion: "   " }).valid, false);
  const missingUpdatedAt = queue(validTask()) as Record<string, unknown>;
  delete missingUpdatedAt.updatedAt;
  assert.equal(validateQueueState(missingUpdatedAt).valid, false);
  assert.equal(validateQueueState({ ...queue(validTask()), updatedAt: "" }).valid, false);
  assert.equal(validateQueueState({ ...queue(validTask()), updatedAt: "2026-08-10" }).valid, false);
});

test("queue state rejects malformed task ids", () => {
  assert.equal(validateQueueState(queue(validTask(), "N2-001")).valid, false);
  assert.equal(validateQueueState(queue(validTask(), "../TASK-N2-001")).valid, false);
  assert.equal(validateQueueState(queue(validTask(), "TASK-")).valid, false);
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

test("queue state rejects malformed evidence links", () => {
  assert.equal(validateQueueState(queue(validTask({ evidenceLinks: {} }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ evidenceLinks: "reports/automation/history/x.json" }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ evidenceLinks: ["reports/automation/history/x.json", 7] }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ evidenceLinks: ["reports/automation/history/x.json"] }))).valid, true);
});

test("queue state requires RFC3339 task timestamps", () => {
  assert.equal(validateQueueState(queue(validTask({ updatedAt: "2026-08-10" }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ updatedAt: "not-a-time" }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ updatedAt: "2026-08-10T00:00:00+09:00" }))).valid, true);
});

test("queue state validates lastFailure structure fail-closed", () => {
  assert.equal(validateQueueState(queue(validTask({ lastFailure: null }))).valid, true);
  assert.equal(validateQueueState(queue(validTask({ lastFailure: "boom" }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ lastFailure: { code: "", at: "2026-08-10T00:00:00Z" } }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ lastFailure: { code: "EXECUTOR_EXCEPTION", at: "2026-08-10" } }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ lastFailure: { code: "EXECUTOR_EXCEPTION", at: "2026-08-10T00:00:00Z", message: 7 } }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ lastFailure: { code: "EXECUTOR_EXCEPTION", at: "2026-08-10T00:00:00Z", extra: true } }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ lastFailure: { code: "EXECUTOR_EXCEPTION", at: "2026-08-10T00:00:00Z", message: "boom" } }))).valid, true);
});

test("queue state validates nextDecision when present", () => {
  assert.equal(validateQueueState(queue(validTask({ nextDecision: "依存 task を次回 dispatch 候補にする（自動起動しない）" }))).valid, true);
  assert.equal(validateQueueState(queue(validTask({ nextDecision: "" }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ nextDecision: "   " }))).valid, false);
  assert.equal(validateQueueState(queue(validTask({ nextDecision: 7 }))).valid, false);
});
