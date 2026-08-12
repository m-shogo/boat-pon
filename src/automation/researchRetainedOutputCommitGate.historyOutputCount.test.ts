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

test("trusted CLI rejects 65 history output paths in a real git worktree", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-history-output-count-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const outputs = Array.from({ length: 65 }, (_, index) => `reports/n2/output-${index}.json`);
    const absoluteHistory = join(root, historyPath);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    writeFileSync(absoluteHistory, `${history(outputs)}\n`, "utf8");
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
      /RETAINED_COMMIT_HISTORY_OUTPUT_COUNT_EXCEEDED:.*:65>64/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
