import assert from "node:assert/strict";
import test from "node:test";
import { computeRequestDigest, REQUEST_SCHEMA_VERSION, validateRequest } from "./researchOrchestrator";

function request(overrides: Record<string, unknown> = {}) {
  const base = {
    requestSchemaVersion: REQUEST_SCHEMA_VERSION,
    requestId: "REQ-20260811-action1",
    taskId: "TASK-N2-011",
    requestedAction: "run-task",
    safetyLevel: "L0",
    authoritySha: "7b71d81",
    queueDigest: "a".repeat(64),
    createdAt: "2026-08-11T02:50:00.000Z",
    requestedBy: "test",
    maxDurationSeconds: 1800,
    expectedOutput: "reports/n2/test.json",
    approvalRequirement: "none",
    ...overrides,
  };
  return { ...base, requestDigest: computeRequestDigest(base) };
}

test("request validator requires NEXT for run-next", () => {
  const invalid = validateRequest(request({ requestedAction: "run-next", taskId: "TASK-N2-011" }));
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /run-next requires taskId NEXT/);

  const valid = validateRequest(request({ requestedAction: "run-next", taskId: "NEXT" }));
  assert.equal(valid.valid, true, valid.errors.join("; "));
});

test("request validator requires dryRun=true for status-only", () => {
  for (const invalidRequest of [
    request({ requestedAction: "status-only" }),
    request({ requestedAction: "status-only", dryRun: false }),
  ]) {
    const invalid = validateRequest(invalidRequest);
    assert.equal(invalid.valid, false);
    assert.match(invalid.errors.join("\n"), /status-only requires dryRun true/);
  }

  const valid = validateRequest(request({ requestedAction: "status-only", dryRun: true }));
  assert.equal(valid.valid, true, valid.errors.join("; "));
});
