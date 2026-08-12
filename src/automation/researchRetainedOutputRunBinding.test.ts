import assert from "node:assert/strict";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const history = (runId: string, taskId = "TASK-N2-011") => `reports/automation/history/${runId}-${taskId}.json`;

function reader(files: Record<string, unknown>): (path: string) => string {
  return (path) => JSON.stringify(files[path]);
}

test("history-only commit cannot create terminal evidence for another workflow run", () => {
  const taskId = "TASK-N2-011";
  const historyPath = history("123", taskId);
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [historyPath],
      expectedRunId: "456",
      readText: reader({
        [historyPath]: { runId: "123", taskId, outputs: [], result: "PASS", blocks: [] },
      }),
    }),
    /RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:123!=456/u,
  );
});

test("same-run history-only commit remains valid", () => {
  const taskId = "TASK-N2-011";
  const historyPath = history("123", taskId);
  const result = validateRetainedOutputCommit({
    changedPaths: [historyPath],
    expectedRunId: "123",
    readText: reader({
      [historyPath]: { runId: "123", taskId, outputs: [], result: "PASS", blocks: [] },
    }),
  });
  assert.equal(result.historyPathCount, 1);
  assert.equal(result.retainedPathCount, 0);
});

test("one workflow run cannot persist two terminal histories", () => {
  const firstTaskId = "TASK-N2-011";
  const secondTaskId = "TASK-N2-012";
  const first = history("123", firstTaskId);
  const second = history("123", secondTaskId);
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [first, second],
      expectedRunId: "123",
      readText: reader({
        [first]: { runId: "123", taskId: firstTaskId, outputs: [], result: "PASS", blocks: [] },
        [second]: { runId: "123", taskId: secondTaskId, outputs: [], result: "PASS", blocks: [] },
      }),
    }),
    /RETAINED_COMMIT_HISTORY_COUNT_INVALID:123:2/u,
  );
});

test("history task identity must match its append-only filename", () => {
  const historyPath = history("123", "TASK-N2-011");
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [historyPath],
      expectedRunId: "123",
      readText: reader({
        [historyPath]: { runId: "123", taskId: "TASK-N2-012", outputs: [], result: "PASS", blocks: [] },
      }),
    }),
    /RETAINED_COMMIT_HISTORY_TASK_ID_MISMATCH/u,
  );
});

test("local mode can inspect multiple histories without pretending to be one workflow run", () => {
  const firstTaskId = "TASK-N2-011";
  const secondTaskId = "TASK-N2-012";
  const first = history("local-a", firstTaskId);
  const second = history("local-b", secondTaskId);
  const result = validateRetainedOutputCommit({
    changedPaths: [first, second],
    expectedRunId: "local",
    readText: reader({
      [first]: { runId: "local-a", taskId: firstTaskId, outputs: [], result: "PASS", blocks: [] },
      [second]: { runId: "local-b", taskId: secondTaskId, outputs: [], result: "PASS", blocks: [] },
    }),
  });
  assert.equal(result.historyPathCount, 2);
  assert.equal(result.retainedPathCount, 0);
});
