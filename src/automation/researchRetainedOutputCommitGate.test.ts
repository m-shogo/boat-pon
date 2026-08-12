import assert from "node:assert/strict";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const taskId = "TASK-N2-011";
const outputDigest = "a".repeat(64);
const idempotencyKey = "b".repeat(64);
const authoritySha = "c".repeat(40);
const retained = (runId: string, name = "a".repeat(64) + "-report.json") =>
  `reports/automation/retained-outputs/${runId}/${name}`;
const history = (runId: string) => `reports/automation/history/${runId}-${taskId}.json`;

function evidence(runId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId,
    requestId: "REQ-test",
    intentId: "INTENT-test",
    taskId,
    taskType: "pit-audit",
    safetyLevel: "L0",
    executorVersion: "test-executor-v1",
    outputs: [],
    result: "PASS",
    blocks: [],
    executed: true,
    outputDigest,
    summary: {},
    idempotencyKey,
    authoritySha,
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:00:01.000Z",
    elapsedMs: 1000,
    ...overrides,
  };
}

function reader(files: Record<string, unknown>): (path: string) => string {
  return (path) => {
    if (!(path in files)) throw new Error(`missing fixture: ${path}`);
    return JSON.stringify(files[path]);
  };
}

test("no retained output is a no-op", () => {
  const result = validateRetainedOutputCommit({
    changedPaths: ["reports/automation/current-status.json"],
    expectedRunId: "123",
    readText: reader({}),
  });
  assert.equal(result.retainedPathCount, 0);
  assert.equal(result.referencedRetainedPathCount, 0);
});

test("same-run terminal history must reference every retained output", () => {
  const output = retained("123");
  const historyPath = history("123");
  const result = validateRetainedOutputCommit({
    changedPaths: [output, historyPath, "reports/automation/current-status.json"],
    expectedRunId: "123",
    readText: reader({ [historyPath]: evidence("123", { outputs: [output] }) }),
  });
  assert.equal(result.retainedPathCount, 1);
  assert.equal(result.referencedRetainedPathCount, 1);
  assert.deepEqual(result.runIds, ["123"]);
});

test("terminal history result must be recognized", () => {
  const historyPath = history("123");
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [historyPath],
      expectedRunId: "123",
      readText: reader({ [historyPath]: evidence("123", { result: undefined }) }),
    }),
    /RETAINED_COMMIT_HISTORY_RESULT_INVALID:.*:missing/u,
  );
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [historyPath],
      expectedRunId: "123",
      readText: reader({ [historyPath]: evidence("123", { result: "RUNNING" }) }),
    }),
    /RETAINED_COMMIT_HISTORY_RESULT_INVALID:.*:RUNNING/u,
  );
});

test("terminal history cannot claim retained output from another run", () => {
  const output = retained("123");
  const historyPath = history("123");
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [output, historyPath],
      expectedRunId: "123",
      readText: reader({ [historyPath]: evidence("123", { outputs: [output, retained("999")] }) }),
    }),
    /RETAINED_COMMIT_HISTORY_RETAINED_RUN_ID_MISMATCH/u,
  );
});

test("history-only change cannot claim retained output from another run", () => {
  const historyPath = history("123");
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [historyPath],
      expectedRunId: "456",
      readText: reader({ [historyPath]: evidence("123", { outputs: [retained("999")] }) }),
    }),
    /RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:123!=456/u,
  );
});

test("terminal history rejects malformed retained-output references", () => {
  const output = retained("123");
  const historyPath = history("123");
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [output, historyPath],
      expectedRunId: "123",
      readText: reader({ [historyPath]: evidence("123", { outputs: [output, "reports/automation/retained-outputs/123/nested/report.json"] }) }),
    }),
    /RETAINED_COMMIT_HISTORY_RETAINED_PATH_INVALID/u,
  );
});

test("orphan retained output is rejected", () => {
  const output = retained("123");
  const historyPath = history("123");
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [output, historyPath],
      expectedRunId: "123",
      readText: reader({ [historyPath]: evidence("123") }),
    }),
    /RETAINED_COMMIT_ORPHAN/u,
  );
});

test("retained output without a changed same-run history is rejected", () => {
  const output = retained("123");
  assert.throws(
    () => validateRetainedOutputCommit({ changedPaths: [output], expectedRunId: "123", readText: reader({}) }),
    /RETAINED_COMMIT_HISTORY_COUNT_INVALID:123:0/u,
  );
});

test("wrong workflow run cannot commit another run retained output", () => {
  const output = retained("124");
  const historyPath = history("124");
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [output, historyPath],
      expectedRunId: "123",
      readText: reader({ [historyPath]: evidence("124", { outputs: [output] }) }),
    }),
    /RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:124!=123/u,
  );
});

test("duplicate changed paths are normalized", () => {
  const output = retained("123");
  const historyPath = history("123");
  const result = validateRetainedOutputCommit({
    changedPaths: [output, output, historyPath, historyPath],
    expectedRunId: "123",
    readText: reader({ [historyPath]: evidence("123", { outputs: [output] }) }),
  });
  assert.equal(result.retainedPathCount, 1);
  assert.equal(result.historyPathCount, 1);
});

test("malformed or mismatched history fails closed", () => {
  const output = retained("123");
  const historyPath = history("123");
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [output, historyPath],
      expectedRunId: "123",
      readText: () => "not-json",
    }),
    /RETAINED_COMMIT_HISTORY_JSON_INVALID/u,
  );
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [output, historyPath],
      expectedRunId: "123",
      readText: reader({ [historyPath]: evidence("999", { outputs: [output] }) }),
    }),
    /RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH/u,
  );
});

test("local mode derives numeric run identity from retained paths", () => {
  const runId = "123";
  const output = retained(runId);
  const historyPath = history(runId);
  const result = validateRetainedOutputCommit({
    changedPaths: [output, historyPath],
    expectedRunId: "local",
    readText: reader({ [historyPath]: evidence(runId, { outputs: [output] }) }),
  });
  assert.deepEqual(result.runIds, [runId]);
});
