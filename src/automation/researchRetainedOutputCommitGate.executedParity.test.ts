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
const outputDigest = "a".repeat(64);
const idempotencyKey = "b".repeat(64);

function history(executed: unknown): string {
  return JSON.stringify({ runId, taskId, result: "PASS", blocks: [], executed, outputDigest, idempotencyKey, outputs: [] });
}

test("retained gate requires terminal history to have executed true", () => {
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [historyPath],
      expectedRunId: runId,
      readText: () => JSON.stringify({ runId, taskId, result: "PASS", blocks: [], outputs: [] }),
    }),
    /RETAINED_COMMIT_HISTORY_EXECUTED_NOT_TRUE/u,
  );
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [historyPath],
      expectedRunId: runId,
      readText: () => history(false),
    }),
    /RETAINED_COMMIT_HISTORY_EXECUTED_NOT_TRUE/u,
  );
  assert.doesNotThrow(() => validateRetainedOutputCommit({
    changedPaths: [historyPath],
    expectedRunId: runId,
    readText: () => history(true),
  }));
});

test("trusted CLI rejects terminal evidence that was not executed", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-executed-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const absoluteHistory = join(root, historyPath);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    writeFileSync(absoluteHistory, `${history(false)}\n`, "utf8");
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
      /RETAINED_COMMIT_HISTORY_EXECUTED_NOT_TRUE/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
