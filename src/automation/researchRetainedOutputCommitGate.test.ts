import assert from "node:assert/strict";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const taskId = "TASK-N2-011";
const outputDigest = "a".repeat(64);
const retained = (runId: string, name = "a".repeat(64) + "-report.json") =>
  `reports/automation/retained-outputs/${runId}/${name}`;
const history = (runId: string) => `reports/automation/history/${runId}-${taskId}.json`;

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
    readText: reader({
      [historyPath]: { runId: "123", taskId, outputs: [output], result: "PASS", blocks: [], executed: true, outputDigest },
    }),
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
      readText: reader({ [historyPath]: { runId: "123", taskId, outputs: [], outputDigest } }),
    }),
    /RETAINED_COMMIT_HISTORY_RESULT_INVALID:.*:missing/u,
  );
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [historyPath],
      expectedRunId: "123",
      readText: reader({ [historyPath]: { runId: "123", taskId, outputs: [], result: "RUNNING", outputDigest } }),
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
      readText: reader({
        [historyPath]: { runId: "123", taskId, outputs: [output, retained("999")], result: "PASS", blocks: [], executed: true, outputDigest },
      }),
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
      readText: reader({
        [historyPath]: { runId: "123", taskId, outputs: [retained("999")], result: "PASS", blocks: [], executed: true, outputDigest },
      }),
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
      readText: reader({
        [historyPath]: { runId: "123", taskId, outputs: [output, "reports/automation/retained-outputs/123/nested/report.json"], result: "PASS", blocks: [], executed: true, outputDigest },
      }),
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
      readText: reader({ [historyPath]: { runId: "123", taskId, outputs: [], result: "PASS", blocks: [], executed: true, outputDigest } }),
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
      readText: reader({ [historyPath]: { runId: "124", taskId, outputs: [output], result: "PASS", blocks: [], executed: true, outputDigest } }),
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
    readText: reader({ [historyPath]: { runId: "123", taskId, outputs: [output], result: "PASS", blocks: [], executed: true, outputDigest } }),
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
      readText: reader({ [historyPath]: { runId: "999", taskId, outputs: [output], result: "PASS", blocks: [], executed: true, outputDigest } }),
    }),
    /RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH/u,
  );
});

test("local mode derives run identity from retained paths", () => {
  const runId = "local-123";
  const output = retained(runId);
  const historyPath = history(runId);
  const result = validateRetainedOutputCommit({
    changedPaths: [output, historyPath],
    expectedRunId: "local",
    readText: reader({ [historyPath]: { runId, taskId, outputs: [output], result: "PASS", blocks: [], executed: true, outputDigest } }),
  });
  assert.deepEqual(result.runIds, [runId]);
});
