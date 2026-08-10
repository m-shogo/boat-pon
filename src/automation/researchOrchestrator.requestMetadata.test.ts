import assert from "node:assert/strict";
import test from "node:test";
import { computeRequestDigest, REQUEST_SCHEMA_VERSION, validateRequest } from "./researchOrchestrator";

function request(overrides: Record<string, unknown> = {}) {
  const base = {
    requestSchemaVersion: REQUEST_SCHEMA_VERSION,
    requestId: "REQ-20260810-meta1",
    taskId: "TASK-N2-011",
    requestedAction: "run-task",
    safetyLevel: "L0",
    authoritySha: "f320f9b",
    queueDigest: "a".repeat(64),
    createdAt: "2026-08-10T13:30:00.000Z",
    requestedBy: "test",
    maxDurationSeconds: 1800,
    expectedOutput: "reports/n2/test.json",
    approvalRequirement: "none",
    ...overrides,
  };
  return { ...base, requestDigest: computeRequestDigest(base) };
}

test("request validator accepts well-formed optional metadata", () => {
  assert.equal(validateRequest(request({ approvalGrantId: "GRANT-existing-001", requestReference: "test:metadata" })).valid, true);
});

test("request validator rejects malformed optional metadata", () => {
  for (const malformed of [
    request({ approvalGrantId: "" }),
    request({ approvalGrantId: 42 }),
    request({ requestReference: "" }),
    request({ requestReference: { hidden: true } }),
  ]) {
    assert.equal(validateRequest(malformed).valid, false);
  }
});
