import assert from "node:assert/strict";
import test from "node:test";
import { computeRequestDigest, REQUEST_SCHEMA_VERSION, validateRequest } from "./researchOrchestrator";

function request(createdAt: string) {
  const base = {
    requestSchemaVersion: REQUEST_SCHEMA_VERSION,
    requestId: "REQ-20260811-created1",
    taskId: "TASK-N2-011",
    requestedAction: "run-task",
    safetyLevel: "L0",
    authoritySha: "72bc5a8",
    queueDigest: "a".repeat(64),
    createdAt,
    requestedBy: "test",
    maxDurationSeconds: 1800,
    expectedOutput: "reports/n2/test.json",
    approvalRequirement: "none",
  };
  return { ...base, requestDigest: computeRequestDigest(base) };
}

test("request validator accepts schema-length timestamps", () => {
  const result = validateRequest(request("2026-08-11T02:55:00Z"));
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("request validator rejects date-only createdAt values accepted by Date.parse", () => {
  const result = validateRequest(request("2026-08-11"));
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /invalid createdAt/);
});
