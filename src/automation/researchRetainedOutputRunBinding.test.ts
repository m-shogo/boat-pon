import assert from "node:assert/strict";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const history = (runId: string) => `reports/automation/history/${runId}-TASK-N2-011.json`;

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
