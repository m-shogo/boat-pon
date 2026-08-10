import assert from "node:assert/strict";
import test from "node:test";
import { computeRequestDigest, REQUEST_SCHEMA_VERSION, validateRequest } from "./researchOrchestrator";

function request(overrides: Record<string, unknown> = {}) {
  const base = {
    requestSchemaVersion: REQUEST_SCHEMA_VERSION,
    requestId: "REQ-20260810-approval1",
    taskId: "TASK-N2-011",
    requestedAction: "run-task",
    safetyLevel: "L0",
    authoritySha: "6cfca7e",
    queueDigest: "a".repeat(64),
    createdAt: "2026-08-10T13:35:00.000Z",
    requestedBy: "test",
    maxDurationSeconds: 1800,
    expectedOutput: "reports/n2/test.json",
    approvalRequirement: "none",
    ...overrides,
  };
  return { ...base, requestDigest: computeRequestDigest(base) };
}

test("L3 canonical request must declare and carry an existing grant", () => {
  assert.equal(validateRequest(request({ safetyLevel: "L3" })).valid, false);
  assert.equal(validateRequest(request({ safetyLevel: "L3", approvalRequirement: "existing-grant-required" })).valid, false);
  assert.equal(validateRequest(request({
    safetyLevel: "L3",
    approvalRequirement: "existing-grant-required",
    approvalGrantId: "GRANT-existing-001",
  })).valid, true);
});

test("non-L3 canonical request cannot claim the L3 approval contract", () => {
  for (const safetyLevel of ["L0", "L1", "L2", "L4"]) {
    const result = validateRequest(request({ safetyLevel, approvalRequirement: "existing-grant-required", approvalGrantId: "GRANT-existing-001" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("non-L3 requires approvalRequirement none"));
  }
});
