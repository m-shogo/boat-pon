import assert from "node:assert/strict";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

function historyText(runId: string): string {
  return JSON.stringify({
    runId,
    requestId: "REQ-test",
    intentId: "INTENT-test",
    taskId: "TASK-N2-011",
    taskType: "readonly-audit",
    safetyLevel: "L0",
    executorVersion: "test-executor-v1",
    result: "PASS",
    blocks: [],
    executed: true,
    outputDigest: "a".repeat(64),
    idempotencyKey: "b".repeat(64),
    authoritySha: "c".repeat(40),
    outputs: [],
    summary: { noChange: true },
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:00:01.000Z",
    elapsedMs: 1000,
  });
}

test("retained commit gate rejects nonnumeric persisted history run ids even in local sentinel mode", () => {
  const runId = "local-12345";
  const historyPath = `reports/automation/history/${runId}-TASK-N2-011.json`;
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [historyPath],
      expectedRunId: "local",
      readText: () => historyText(runId),
    }),
    /RETAINED_COMMIT_HISTORY_PATH_INVALID/u,
  );
});

test("retained commit gate still accepts numeric persisted history in local sentinel mode", () => {
  const runId = "12345";
  const historyPath = `reports/automation/history/${runId}-TASK-N2-011.json`;
  assert.doesNotThrow(() => validateRetainedOutputCommit({
    changedPaths: [historyPath],
    expectedRunId: "local",
    readText: () => historyText(runId),
  }));
});
