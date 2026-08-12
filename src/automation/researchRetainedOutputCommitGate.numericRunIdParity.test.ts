import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

test("trusted CLI rejects nonnumeric persisted history in local sentinel mode", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-numeric-run-id-parity-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  const runId = "local-12345";
  const historyPath = `reports/automation/history/${runId}-TASK-N2-011.json`;
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const absoluteHistory = join(root, historyPath);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    writeFileSync(absoluteHistory, `${historyText(runId)}\n`, "utf8");

    assert.throws(
      () => execFileSync(process.execPath, [gateCli, "--run-id=local"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, TRUSTED_GIT_BIN: trustedGitBin, GITHUB_ACTIONS: "false", GITHUB_RUN_ID: "" },
      }),
      /RETAINED_COMMIT_HISTORY_PATH_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
