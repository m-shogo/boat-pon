import assert from "node:assert/strict";
import test from "node:test";
import { validateRequest } from "./researchOrchestrator";
import {
  INTENT_SCHEMA_VERSION, assertReplayLedgersConsistent, buildCanonicalRequest, computeIdempotencyKey, findIdempotentSuccess,
  isIntentProcessed, isRequestReplay, validateIntent,
} from "./dispatchIntent";
import type { MergedTask } from "./taskCatalog";

const AUTHORITY_SHA = "94f57f5612926cea091bfe5ce291474fad9b906c";

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
    intent: validateIntent(intent()).intent!, authoritySha: AUTHORITY_SHA,
    queueDigest: "a".repeat(64), createdAt: "2026-08-04T05:00:00.000Z", task,
  });
  assert.deepEqual(errors, []);
  assert.equal(request.taskId, "TASK-N2-004");
  assert.equal(request.safetyLevel, "L0");
  assert.equal(request.requestedAction, "run-task");
  assert.equal(request.requestId, "REQ-20260804-abcdef0123");
  assert.equal(request.expectedOutput, "reports/n2/n2-dataset-inventory.json");
  const v = validateRequest(request as unknown as Record<string, unknown>);
  assert.deepEqual(v.errors, []);
  assert.equal(v.valid, true);
});

test("canonical request rejects intent claiming lower safety than catalog", () => {
  const hi = { ...task, safetyLevel: "L2" as const };
  const { errors } = buildCanonicalRequest({
    intent: validateIntent(intent({ safetyLevel: "L0" })).intent!, authoritySha: AUTHORITY_SHA,
    queueDigest: "a".repeat(64), createdAt: "2026-08-04T05:00:00.000Z", task: hi,
  });
  assert.ok(errors.some((e) => e.includes("below catalog safety")));
});

test("canonical request rejects intent duration above the catalog task cap", () => {
  const cappedTask = { ...task, maxDurationSeconds: 600 };
  const { errors } = buildCanonicalRequest({
    intent: validateIntent(intent({ maxDurationSeconds: 601 })).intent!, authoritySha: AUTHORITY_SHA,
    queueDigest: "a".repeat(64), createdAt: "2026-08-04T05:00:00.000Z", task: cappedTask,
  });
  assert.ok(errors.some((e) => e.includes("exceeds catalog maxDurationSeconds")));

  const withinCap = buildCanonicalRequest({
    intent: validateIntent(intent({ maxDurationSeconds: 600 })).intent!, authoritySha: AUTHORITY_SHA,
    queueDigest: "a".repeat(64), createdAt: "2026-08-04T05:00:00.000Z", task: cappedTask,
  });
  assert.deepEqual(withinCap.errors, []);
});

test("dry-run intent sets dryRun and stays valid", () => {
  const { request } = buildCanonicalRequest({
    intent: validateIntent(intent({ requestedAction: "dry-run" })).intent!, authoritySha: AUTHORITY_SHA,
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
  assert.equal(isIntentProcessed({ intentIds: ["INTENT-aaaa"], entries: [{ intentId: "INTENT-aaaa", requestId: "REQ-aaaa", result: "PASS", recordedAt: "2026-08-04T05:00:00.000Z" }] }, "INTENT-aaaa"), true);
  assert.equal(isIntentProcessed({ intentIds: [], entries: [] }, "INTENT-aaaa"), false);
  assert.equal(isRequestReplay({ requestIds: ["REQ-aaaa"], idempotencyKeys: {} }, "REQ-aaaa"), true);
  const successKey = "a".repeat(64);
  const failureKey = "b".repeat(64);
  const led = { requestIds: ["REQ-0001", "REQ-0002"], idempotencyKeys: {
    [successKey]: { requestId: "REQ-0001", result: "PASS", evidencePath: "reports/automation/history/123-TASK-N2-004.json", recordedAt: "2026-08-04T05:00:00.000Z" },
    [failureKey]: { requestId: "REQ-0002", result: "FAILED_FINAL", recordedAt: "2026-08-04T05:01:00.000Z" },
  } };
  assert.equal(findIdempotentSuccess(led, successKey)?.requestId, "REQ-0001");
  assert.equal(findIdempotentSuccess(led, failureKey), null);
});

test("processed intent entries must stay aligned with intentIds", () => {
  const valid = {
    intentIds: ["INTENT-20260804-a", "INTENT-20260804-b"],
    entries: [
      { intentId: "INTENT-20260804-a", requestId: "REQ-20260804-a", result: "PASS", recordedAt: "2026-08-04T05:00:00.000Z" },
      { intentId: "INTENT-20260804-b", requestId: "REQ-20260804-b", result: "BLOCKED", recordedAt: "2026-08-04T05:01:00.000Z" },
    ],
  };
  assert.equal(isIntentProcessed(valid, "INTENT-20260804-a"), true);
  assert.equal(isIntentProcessed(valid, "INTENT-20260804-c"), false);
  assert.equal(isIntentProcessed({ intentIds: [] }, "INTENT-20260804-c"), true);
  assert.equal(isIntentProcessed({ ...valid, entries: valid.entries.slice(0, 1) }, "INTENT-20260804-c"), true);
  assert.equal(isIntentProcessed({ ...valid, entries: [valid.entries[0], valid.entries[0]] }, "INTENT-20260804-c"), true);
  assert.equal(isIntentProcessed({ ...valid, entries: [{ ...valid.entries[0], intentId: "INTENT-20260804-c" }, valid.entries[1]] }, "INTENT-20260804-c"), true);
  assert.equal(isIntentProcessed({ ...valid, entries: [{ ...valid.entries[0], requestId: "REQ-20260804-wrong" }, valid.entries[1]] }, "INTENT-20260804-c"), true);
  assert.equal(isIntentProcessed({ ...valid, entries: [{ ...valid.entries[0], recordedAt: "not-a-time" }, valid.entries[1]] }, "INTENT-20260804-c"), true);
});

test("cross-ledger lineage rejects an intent entry missing from processed requests", () => {
  const intents = {
    intentIds: ["INTENT-20260804-a"],
    entries: [{ intentId: "INTENT-20260804-a", requestId: "REQ-20260804-a", result: "PASS", recordedAt: "2026-08-04T05:00:00.000Z" }],
  };
  assert.doesNotThrow(() => assertReplayLedgersConsistent(intents, { requestIds: ["REQ-legacy", "REQ-20260804-a"], idempotencyKeys: {} }));
  assert.throws(
    () => assertReplayLedgersConsistent(intents, { requestIds: ["REQ-legacy"], idempotencyKeys: {} }),
    /cross-ledger mismatch/,
  );
});

test("cross-ledger lineage fails closed on missing or malformed ledgers", () => {
  const intents = { intentIds: [], entries: [] };
  const requests = { requestIds: [], idempotencyKeys: {} };
  assert.throws(() => assertReplayLedgersConsistent(null, requests), /missing processed intent ledger/);
  assert.throws(() => assertReplayLedgersConsistent(intents, null), /missing processed request ledger/);
  assert.throws(() => assertReplayLedgersConsistent({ intentIds: [] } as any, requests), /malformed processed intent ledger/);
  assert.throws(() => assertReplayLedgersConsistent(intents, { requestIds: [], idempotencyKeys: null } as any), /malformed processed request ledger/);
});

test("malformed replay ledgers fail closed instead of reopening work", () => {
  const key = "a".repeat(64);
  assert.equal(isIntentProcessed({ intentIds: null } as any, "INTENT-aaaa"), true);
  assert.equal(isIntentProcessed({ intentIds: ["INTENT-aaaa", "INTENT-aaaa"] } as any, "INTENT-bbbb"), true);
  assert.equal(isIntentProcessed({ intentIds: ["INTENT-aaaa", 7] } as any, "INTENT-bbbb"), true);
  assert.equal(isIntentProcessed({ intentIds: ["wrong-namespace"] } as any, "INTENT-bbbb"), true);
  assert.equal(isRequestReplay({ requestIds: null, idempotencyKeys: {} } as any, "REQ-aaaa"), true);
  assert.equal(isRequestReplay({ requestIds: ["REQ-aaaa", "REQ-aaaa"], idempotencyKeys: {} } as any, "REQ-bbbb"), true);
  assert.equal(isRequestReplay({ requestIds: ["REQ-aaaa", false], idempotencyKeys: {} } as any, "REQ-bbbb"), true);
  assert.equal(isRequestReplay({ requestIds: ["wrong-namespace"], idempotencyKeys: {} } as any, "REQ-bbbb"), true);
  assert.equal(isRequestReplay({ requestIds: [], idempotencyKeys: null } as any, "REQ-bbbb"), true);
  assert.equal(isRequestReplay({
    requestIds: [],
    idempotencyKeys: { [key]: { requestId: "REQ-orphan", result: "PASS", recordedAt: "2026-08-04T05:00:00.000Z" } },
  } as any, "REQ-bbbb"), true);
});

test("malformed idempotency ledgers block lookup before execution", () => {
  const key = "a".repeat(64);
  assert.throws(() => findIdempotentSuccess(null, key), /missing processed request ledger/);
  assert.throws(() => findIdempotentSuccess({ requestIds: [], idempotencyKeys: null } as any, key), /malformed processed request ledger/);
  assert.throws(() => findIdempotentSuccess({
    requestIds: [],
    idempotencyKeys: { bad: { requestId: "REQ-0001", result: "PASS", recordedAt: "2026-08-04T05:00:00.000Z" } },
  } as any, key), /malformed processed request ledger/);
  assert.throws(() => findIdempotentSuccess({
    requestIds: [],
    idempotencyKeys: { [key]: { requestId: "REQ-0001", result: "PASS" } },
  } as any, key), /malformed processed request ledger/);
  assert.throws(() => findIdempotentSuccess({
    requestIds: ["REQ-0001", "REQ-0001"],
    idempotencyKeys: {},
  } as any, key), /malformed processed request ledger/);
  assert.throws(() => findIdempotentSuccess({
    requestIds: [],
    idempotencyKeys: { [key]: { requestId: "REQ-orphan", result: "PASS", recordedAt: "2026-08-04T05:00:00.000Z" } },
  } as any, key), /idempotency requestId not recorded/);
  assert.throws(() => findIdempotentSuccess({
    requestIds: ["wrong-namespace"],
    idempotencyKeys: {},
  } as any, key), /malformed processed request ledger/);
  for (const evidencePath of ["/tmp/private.json", "../private.json", "reports/automation/history/../../private.json"]) {
    assert.throws(() => findIdempotentSuccess({
      requestIds: ["REQ-0001"],
      idempotencyKeys: { [key]: { requestId: "REQ-0001", result: "PASS", evidencePath, recordedAt: "2026-08-04T05:00:00.000Z" } },
    } as any, key), /malformed processed request ledger/);
  }
});
