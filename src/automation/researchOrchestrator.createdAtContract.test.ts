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

test("request validator accepts valid leap-day timestamps with offsets", () => {
  const result = validateRequest(request("2028-02-29T11:55:00+09:00"));
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("request validator rejects date-only or timezone-less createdAt values", () => {
  for (const createdAt of [
    "2026-08-11",
    "2026-08-11T02:55:00.000",
  ]) {
    const result = validateRequest(request(createdAt));
    assert.equal(result.valid, false, createdAt);
    assert.match(result.errors.join("\n"), /invalid createdAt/, createdAt);
  }
});

test("request validator rejects impossible calendar dates normalized by Date.parse", () => {
  for (const createdAt of [
    "2026-02-29T02:55:00Z",
    "2026-02-30T02:55:00Z",
    "2026-04-31T11:55:00+09:00",
  ]) {
    const result = validateRequest(request(createdAt));
    assert.equal(result.valid, false, createdAt);
    assert.match(result.errors.join("\n"), /invalid createdAt/, createdAt);
  }
});

test("request validator rejects normalized or impossible clocks", () => {
  for (const createdAt of [
    "2026-08-11T24:00:00Z",
    "2026-08-11T23:60:00Z",
    "2026-08-11T23:59:60Z",
  ]) {
    const result = validateRequest(request(createdAt));
    assert.equal(result.valid, false, createdAt);
    assert.match(result.errors.join("\n"), /invalid createdAt/, createdAt);
  }
});
