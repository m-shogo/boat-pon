import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const runId = "12345";
const taskId = "TASK-N2-011";
const historyPath = `reports/automation/history/${runId}-${taskId}.json`;

function history(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId,
    requestId: "REQ-test",
    intentId: "INTENT-test",
    taskId,
    taskType: "pit-audit",
    safetyLevel: "L0",
    executorVersion: "test-executor-v1",
    executed: true,
    result: "PASS",
    blocks: [],
    outputs: [],
    outputDigest: "a".repeat(64),
    summary: {},
    authoritySha: "b".repeat(40),
    idempotencyKey: "c".repeat(64),
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:00:01.000Z",
    elapsedMs: 1000,
    ...overrides,
  };
}

function validate(overrides: Record<string, unknown> = {}): void {
  validateRetainedOutputCommit({
    changedPaths: [historyPath],
    expectedRunId: runId,
    readText: () => JSON.stringify(history(overrides)),
  });
}

test("retained gate requires the durable history envelope", () => {
  assert.doesNotThrow(() => validate());
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ requestId: "" }, /RETAINED_COMMIT_HISTORY_REQUEST_ID_INVALID/u],
    [{ intentId: null }, /RETAINED_COMMIT_HISTORY_INTENT_ID_INVALID/u],
    [{ taskType: "" }, /RETAINED_COMMIT_HISTORY_TASK_TYPE_INVALID/u],
    [{ safetyLevel: "L4" }, /RETAINED_COMMIT_HISTORY_SAFETY_LEVEL_INVALID/u],
    [{ executorVersion: "" }, /RETAINED_COMMIT_HISTORY_EXECUTOR_VERSION_INVALID/u],
    [{ startedAt: "not-an-instant" }, /RETAINED_COMMIT_HISTORY_STARTED_AT_INVALID/u],
    [{ completedAt: null }, /RETAINED_COMMIT_HISTORY_COMPLETED_AT_INVALID/u],
    [{ startedAt: "2026-08-12T00:00:02.000Z" }, /RETAINED_COMMIT_HISTORY_TIME_ORDER_INVALID/u],
    [{ elapsedMs: -1 }, /RETAINED_COMMIT_HISTORY_ELAPSED_MS_INVALID/u],
    [{ elapsedMs: 1.5 }, /RETAINED_COMMIT_HISTORY_ELAPSED_MS_INVALID/u],
  ];
  for (const [overrides, expected] of cases) {
    assert.throws(() => validate(overrides), expected);
  }
});

test("trusted CLI rejects a history envelope that durable audit would reject", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-envelope-parity-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const absoluteHistory = join(root, historyPath);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    writeFileSync(absoluteHistory, `${JSON.stringify(history({ safetyLevel: "L4" }))}\n`, "utf8");
    assert.throws(
      () => execFileSync(process.execPath, [gateCli, `--run-id=${runId}`], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          TRUSTED_GIT_BIN: trustedGitBin,
          GITHUB_ACTIONS: "false",
          GITHUB_RUN_ID: "",
        },
      }),
      /RETAINED_COMMIT_HISTORY_SAFETY_LEVEL_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});