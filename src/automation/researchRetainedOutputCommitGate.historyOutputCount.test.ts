import assert from "node:assert/strict";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const runId = "12345";
const taskId = "TASK-N2-011";
const historyPath = `reports/automation/history/${runId}-${taskId}.json`;

function history(outputs: string[]): string {
  return JSON.stringify({
    runId,
    requestId: "REQ-test",
    intentId: "INTENT-test",
    taskId,
    taskType: "readonly-audit",
    safetyLevel: "L0",
    executorVersion: "test-executor-v1",
    result: "PASS",
    blocks: [],
    executed: true,
    outputDigest: "a".repeat(64),
    idempotencyKey: "b".repeat(64),
    authoritySha: "c".repeat(40),
    outputs,
    summary: {},
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:00:01.000Z",
    elapsedMs: 1000,
  });
}

function validate(outputs: string[]): void {
  validateRetainedOutputCommit({
    changedPaths: [historyPath],
    expectedRunId: runId,
    readText: () => history(outputs),
  });
}

test("retained history accepts the canonical producer ceiling of 64 output paths", () => {
  const outputs = Array.from({ length: 64 }, (_, index) => `reports/n2/output-${index}.json`);
  assert.doesNotThrow(() => validate(outputs));
});

test("retained history rejects 65 output paths even when no retained artifact is newly changed", () => {
  const outputs = Array.from({ length: 65 }, (_, index) => `reports/n2/output-${index}.json`);
  assert.throws(
    () => validate(outputs),
    /RETAINED_COMMIT_HISTORY_OUTPUT_COUNT_EXCEEDED:.*:65>64/u,
  );
});
