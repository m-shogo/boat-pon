import assert from "node:assert/strict";
import test from "node:test";
import { validateRequest } from "./researchOrchestrator";
import {
  INTENT_SCHEMA_VERSION, buildCanonicalRequest, computeIdempotencyKey, findIdempotentSuccess,
  isIntentProcessed, isRequestReplay, validateIntent,
} from "./dispatchIntent";
import type { MergedTask } from "./taskCatalog";

function intent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intentSchemaVersion: INTENT_SCHEMA_VERSION, intentId: "INTENT-20260804-abcdef0123",
    taskId: "TASK-N2-004", requestedAction: "run-task", safetyLevel: "L0",
    expectedAuthoritySha: "94f57f5", maxDurationSeconds: 1800, requestedBy: "chatgpt-scheduled-task",
    requestReference: "chatgpt-hourly:run-1", ...over,
  };
}
const task: MergedTask = {
  taskId: "TASK-N2-004", taskDefinitionVersion: 1, title: "t", objective: "o", taskType: "dataset-expand",
  executor: "dataset-expand", safetyLevel: "L0", dependencies: [], maxDurationSeconds: 3600,
  expectedInputs: [], expectedOutputs: ["reports/n2/n2-dataset-inventory.json"], estimatedDurationSeconds: 300,
  defaultStatus: "READY", valueOfInformation: "v", invalidationCondition: "i", status: "READY", state: null, staleDefinition: false,
};

test("valid intent passes; ChatGPT supplies no hashes", () => {
  const r = validateIntent(intent());
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
});

test("intent rejects hash/digest fields as unknown (no hashing required from ChatGPT)", () => {
  assert.ok(validateIntent(intent({ queueDigest: "x" })).errors.some((e) => e.includes("unknown field: queueDigest")));
  assert.ok(validateIntent(intent({ requestDigest: "x" })).errors.some((e) => e.includes("unknown field: requestDigest")));
});

test("intent rejects L4, bad ids, missing fields", () => {
  assert.equal(validateIntent(intent({ safetyLevel: "L4" })).valid, false);
  assert.equal(validateIntent(intent({ intentId: "REQ-x" })).valid, false);
  const missing = intent(); delete (missing as any).taskId;
  assert.equal(validateIntent(missing).valid, false);
});

test("canonical request is valid per orchestrator schema and preserves intent semantics", () => {
  const { request, errors } = buildCanonicalRequest({
    intent: validateIntent(intent()).intent!, authoritySha: "94f57f5612926cea091bfe5ce291474fad9b906c",
    queueDigest: "a".repeat(64), createdAt: "2026-08-04T05:00:00.000Z", task,
  });
  assert.deepEqual(errors, []);
  assert.equal(request.taskId, "TASK-N2-004");
  assert.equal(request.safetyLevel, "L0");
  assert.equal(request.requestedAction, "run-task");
  assert.equal(request.requestId, "REQ-20260804-abcdef0123"); // derived from intentId
  assert.equal(request.expectedOutput, "reports/n2/n2-dataset-inventory.json"); // from catalog
  const v = validateRequest(request as unknown as Record<string, unknown>);
  assert.deepEqual(v.errors, []);
  assert.equal(v.valid, true);
});

test("canonical request rejects intent claiming lower safety than catalog", () => {
  const hi = { ...task, safetyLevel: "L2" as const };
  const { errors } = buildCanonicalRequest({
    intent: validateIntent(intent({ safetyLevel: "L0" })).intent!, authoritySha: "a".repeat(40),
    queueDigest: "a".repeat(64), createdAt: "2026-08-04T05:00:00.000Z", task: hi,
  });
  assert.ok(errors.some((e) => e.includes("below catalog safety")));
});

test("canonical request rejects intent duration above the catalog task cap", () => {
  const cappedTask = { ...task, maxDurationSeconds: 600 };
  const { errors } = buildCanonicalRequest({
    intent: validateIntent(intent({ maxDurationSeconds: 601 })).intent!, authoritySha: "a".repeat(40),
    queueDigest: "a".repeat(64), createdAt: "2026-08-04T05:00:00.000Z", task: cappedTask,
  });
  assert.ok(errors.some((e) => e.includes("exceeds catalog maxDurationSeconds")));

  const withinCap = buildCanonicalRequest({
    intent: validateIntent(intent({ maxDurationSeconds: 600 })).intent!, authoritySha: "a".repeat(40),
    queueDigest: "a".repeat(64), createdAt: "2026-08-04T05:00:00.000Z", task: cappedTask,
  });
  assert.deepEqual(withinCap.errors, []);
});

test("dry-run intent sets dryRun and stays valid", () => {
  const { request } = buildCanonicalRequest({
    intent: validateIntent(intent({ requestedAction: "dry-run" })).intent!, authoritySha: "a".repeat(40),
    queueDigest: "a".repeat(64), createdAt: "2026-08-04T05:00:00.000Z", task,
  });
  assert.equal(request.dryRun, true);
  assert.deepEqual(validateRequest(request as unknown as Record<string, unknown>).errors, []);
});

test("idempotency key is stable and input-sensitive", () => {
  const base = { taskId: "TASK-N2-004", taskDefinitionVersion: 1, authoritySha: "abc1234", stateVersion: 5, executorVersion: "ev1", inputIdentity: "id1", safetyLevel: "L0" };
  assert.equal(computeIdempotencyKey(base), computeIdempotencyKey({ ...base }));
  assert.notEqual(computeIdempotencyKey(base), computeIdempotencyKey({ ...base, stateVersion: 6 }));
  assert.notEqual(computeIdempotencyKey(base), computeIdempotencyKey({ ...base, executorVersion: "ev2" }));
});

test("ledger replay + idempotent-success lookups", () => {
  assert.equal(isIntentProcessed({ intentIds: ["INTENT-a"] }, "INTENT-a"), true);
  assert.equal(isIntentProcessed({ intentIds: [] }, "INTENT-a"), false);
  assert.equal(isRequestReplay({ requestIds: ["REQ-a"], idempotencyKeys: {} }, "REQ-a"), true);
  const led = { requestIds: [], idempotencyKeys: { k1: { requestId: "REQ-1", result: "PASS", recordedAt: "t" }, k2: { requestId: "REQ-2", result: "FAILED_FINAL", recordedAt: "t" } } };
  assert.equal(findIdempotentSuccess(led, "k1")?.requestId, "REQ-1");
  assert.equal(findIdempotentSuccess(led, "k2"), null); // failures are not idempotent successes
});
