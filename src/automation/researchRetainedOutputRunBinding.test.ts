import assert from "node:assert/strict";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const history = (runId: string, taskId = "TASK-N2-011") => `reports/automation/history/${runId}-${taskId}.json`;

function reader(files: Record<string, unknown>): (path: string) => string {
  return (path) => JSON.stringify(files[path]);
}

test("history-only commit cannot create terminal evidence for another workflow run", () => {
  const historyPath = history("123");
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [historyPath],
      expectedRunId: "456",
      readText: reader({
        [historyPath]: { runId: "123", outputs: [], result: "PASS" },
      }),
    }),
    /RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:123!=456/u,
  );
});

test("same-run history-only commit remains valid", () => {
  const historyPath = history("123");
  const result = validateRetainedOutputCommit({
    changedPaths: [historyPath],
    expectedRunId: "123",
    readText: reader({
      [historyPath]: { runId: "123", outputs: [], result: "PASS" },
    }),
  });
  assert.equal(result.historyPathCount, 1);
  assert.equal(result.retainedPathCount, 0);
});

test("one workflow run cannot persist two terminal histories", () => {
  const first = history("123", "TASK-N2-011");
  const second = history("123", "TASK-N2-012");
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [first, second],
      expectedRunId: "123",
      readText: reader({
        [first]: { runId: "123", outputs: [], result: "PASS" },
        [second]: { runId: "123", outputs: [], result: "PASS" },
      }),
    }),
    /RETAINED_COMMIT_HISTORY_COUNT_INVALID:123:2/u,
  );
});

test("local mode can inspect multiple histories without pretending to be one workflow run", () => {
  const first = history("local-a", "TASK-N2-011");
  const second = history("local-b", "TASK-N2-012");
  const result = validateRetainedOutputCommit({
    changedPaths: [first, second],
    expectedRunId: "local",
    readText: reader({
      [first]: { runId: "local-a", outputs: [], result: "PASS" },
      [second]: { runId: "local-b", outputs: [], result: "PASS" },
    }),
  });
  assert.equal(result.historyPathCount, 2);
  assert.equal(result.retainedPathCount, 0);
});
