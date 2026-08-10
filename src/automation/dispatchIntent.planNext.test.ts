import assert from "node:assert/strict";
import test from "node:test";
import { INTENT_SCHEMA_VERSION, validateIntent } from "./dispatchIntent";

function intent(taskId: string, requestedAction: string) {
  return {
    intentSchemaVersion: INTENT_SCHEMA_VERSION,
    intentId: "INTENT-20260810-plan1",
    taskId,
    requestedAction,
    safetyLevel: "L0",
    expectedAuthoritySha: "3dd5ce9",
    maxDurationSeconds: 1800,
    requestedBy: "test",
    requestReference: "test:plan-next-binding",
  };
}

test("plan-next is valid only for the NEXT selector", () => {
  assert.equal(validateIntent(intent("NEXT", "plan-next")).valid, true);
  const specific = validateIntent(intent("TASK-N2-011", "plan-next"));
  assert.equal(specific.valid, false);
  assert.ok(specific.errors.includes("plan-next requires taskId NEXT"));
});

test("run-task remains valid for a specific task", () => {
  assert.equal(validateIntent(intent("TASK-N2-011", "run-task")).valid, true);
});
