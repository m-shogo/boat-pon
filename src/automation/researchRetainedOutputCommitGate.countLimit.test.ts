import { describe, expect, it } from "vitest";
import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const RUN_ID = "123456789";
const HISTORY_PATH = `reports/automation/history/${RUN_ID}-TASK-N2-TEST.json`;
const DIGEST = "a".repeat(64);

function history(outputs: string[]): string {
  return JSON.stringify({
    runId: RUN_ID,
    taskId: "TASK-N2-TEST",
    result: "PASS",
    blocks: [],
    executed: true,
    outputDigest: "b".repeat(64),
    idempotencyKey: "c".repeat(64),
    authoritySha: "d".repeat(40),
    outputs,
    summary: {},
    requestId: "REQ-test",
    intentId: "INTENT-test",
    taskType: "research-test",
    safetyLevel: "L2",
    executorVersion: "test-v1",
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:00:01.000Z",
    elapsedMs: 1000,
  });
}

describe("validateRetainedOutputCommit retained count ceiling", () => {
  it("accepts the canonical producer ceiling of 64 retained paths", () => {
    const retained = Array.from(
      { length: 64 },
      (_, index) => `reports/automation/retained-outputs/${RUN_ID}/${DIGEST}-output-${index}.json`,
    );

    expect(validateRetainedOutputCommit({
      changedPaths: [HISTORY_PATH, ...retained],
      expectedRunId: RUN_ID,
      readText: () => history(retained),
    }).retainedPathCount).toBe(64);
  });

  it("rejects 65 retained paths even when every path is canonical and referenced", () => {
    const retained = Array.from(
      { length: 65 },
      (_, index) => `reports/automation/retained-outputs/${RUN_ID}/${DIGEST}-output-${index}.json`,
    );

    expect(() => validateRetainedOutputCommit({
      changedPaths: [HISTORY_PATH, ...retained],
      expectedRunId: RUN_ID,
      readText: () => history(retained),
    })).toThrow("RETAINED_COMMIT_COUNT_EXCEEDED:65>64");
  });
});
