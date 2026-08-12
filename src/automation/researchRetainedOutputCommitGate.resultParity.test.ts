import assert from "node:assert/strict";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const path = "reports/automation/history/12345-TASK-N2-011.json";

function validate(result: string): void {
  const blocks = result === "BLOCKED" || result === "FAILED" ? ["terminal-block"] : [];
  validateRetainedOutputCommit({
    changedPaths: [path],
    expectedRunId: "12345",
    readText: () => JSON.stringify({
      runId: "12345",
      taskId: "TASK-N2-011",
      outputs: [],
      blocks,
      executed: true,
      result,
    }),
  });
}

test("retained history result contract rejects persisted dry runs", () => {
  for (const result of ["PASS", "CONDITIONAL", "BLOCKED", "FAILED"]) {
    assert.doesNotThrow(() => validate(result), result);
  }
  for (const result of ["DRY_RUN_OK", "FAILED_FINAL", "FAILED_RETRYABLE", "REJECTED_L4", "TASK_NOT_FOUND", "TASK_NOT_READY"]) {
    assert.throws(() => validate(result), /RETAINED_COMMIT_HISTORY_RESULT_INVALID/u, result);
  }
});
