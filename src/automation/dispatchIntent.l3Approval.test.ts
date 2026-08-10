import assert from "node:assert/strict";
import test from "node:test";
import { INTENT_SCHEMA_VERSION, validateIntent } from "./dispatchIntent";

function intent(overrides: Record<string, unknown> = {}) {
  return {
    intentSchemaVersion: INTENT_SCHEMA_VERSION,
    intentId: "INTENT-20260810-l3safe",
    taskId: "TASK-N2-011",
    requestedAction: "run-task",
    safetyLevel: "L3",
    expectedAuthoritySha: "848f0b0",
    maxDurationSeconds: 1800,
    requestedBy: "test",
    requestReference: "test:l3-approval-runtime",
    ...overrides,
  };
}

test("L3 intent requires an existing approval grant at runtime", () => {
  const missing = validateIntent(intent());
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.includes("L3 requires approvalGrantId"));

  const blank = validateIntent(intent({ approvalGrantId: "" }));
  assert.equal(blank.valid, false);
  assert.ok(blank.errors.includes("invalid approvalGrantId"));

  assert.equal(validateIntent(intent({ approvalGrantId: "GRANT-existing-001" })).valid, true);
});

test("lower safety levels do not require an approval grant", () => {
  assert.equal(validateIntent(intent({ safetyLevel: "L2" })).valid, true);
});
