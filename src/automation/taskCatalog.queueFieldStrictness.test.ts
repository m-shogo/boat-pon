import assert from "node:assert/strict";
import test from "node:test";
import { QUEUE_STATE_SCHEMA_VERSION, validateQueueState } from "./taskCatalog";

function task(overrides: Record<string, unknown> = {}) {
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
    updatedAt: "2026-08-11T03:00:00.000Z",
    ...overrides,
  };
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    stateSchemaVersion: QUEUE_STATE_SCHEMA_VERSION,
    stateVersion: 51,
    catalogVersion: "2026-08-06-n2-governance-v8",
    updatedAt: "2026-08-11T03:00:00.000Z",
    tasks: { "TASK-N2-020": task() },
    ...overrides,
  };
}

test("queue validator accepts canonical authority fields", () => {
  const result = validateQueueState(state());
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("queue validator rejects unknown top-level authority fields", () => {
  const result = validateQueueState(state({ hiddenAuthority: true }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /unknown state field: hiddenAuthority/);
});

test("queue validator rejects unknown task-state authority fields", () => {
  const result = validateQueueState(state({ tasks: { "TASK-N2-020": task({ hiddenAuthority: true }) } }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /state TASK-N2-020 unknown field: hiddenAuthority/);
});
