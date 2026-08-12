import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const historyPath = "reports/automation/history/123-TASK-N2-011.json";
const base = {
  runId: "123",
  requestId: "REQ-test",
  intentId: "INTENT-test",
  taskId: "TASK-N2-011",
  taskType: "pit-audit",
  safetyLevel: "L0",
  executorVersion: "test-executor-v1",
  outputs: [],
  result: "PASS",
  blocks: [],
  executed: true,
  outputDigest: "a".repeat(64),
  summary: {},
  idempotencyKey: "b".repeat(64),
  authoritySha: "c".repeat(40),
  startedAt: "2026-08-12T00:00:00.000Z",
  completedAt: "2026-08-12T00:00:01.000Z",
  elapsedMs: 1000,
};

function validate(overrides: Record<string, unknown>): void {
  validateRetainedOutputCommit({
    changedPaths: [historyPath],
    expectedRunId: "123",
    readText: () => JSON.stringify({ ...base, ...overrides }),
  });
}

test("retained history identity fields are not string-coerced", () => {
  assert.throws(() => validate({ runId: 123 }), /RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH/u);
  assert.throws(() => validate({ taskId: ["TASK-N2-011"] }), /RETAINED_COMMIT_HISTORY_TASK_ID_MISMATCH/u);
  assert.throws(() => validate({ result: ["PASS"] }), /RETAINED_COMMIT_HISTORY_RESULT_INVALID/u);
});

test("trusted commit CLI mirrors strict identity field types", () => {
  const source = readFileSync(resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs"), "utf8");
  assert.match(source, /typeof history\.runId !== "string" \|\| history\.runId !== pathRunId/u);
  assert.match(source, /typeof history\.taskId !== "string" \|\| history\.taskId !== pathTaskId/u);
  assert.match(source, /typeof history\.result !== "string" \|\| !TERMINAL_RESULTS\.has\(history\.result\)/u);
  assert.doesNotMatch(source, /String\(history\.(?:runId|taskId|result)/u);
});
