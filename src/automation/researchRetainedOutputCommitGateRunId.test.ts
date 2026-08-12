import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const taskId = "TASK-N2-011";

function historyText(runId: string): string {
  return JSON.stringify({ runId, taskId, result: "PASS", blocks: [], outputs: [] });
}

test("retained commit gate rejects noncanonical history run ids in local inspection mode", () => {
  for (const runId of [".", "..", "local-run", "123abc"]) {
    const historyPath = `reports/automation/history/${runId}-${taskId}.json`;
    assert.throws(
      () => validateRetainedOutputCommit({
        changedPaths: [historyPath],
        expectedRunId: "local",
        readText: () => historyText(runId),
      }),
      /RETAINED_COMMIT_HISTORY_PATH_INVALID/u,
    );
  }
});

test("retained commit gate rejects noncanonical explicit expected run ids", () => {
  for (const runId of [".", "..", "local-run", "123abc"]) {
    assert.throws(
      () => validateRetainedOutputCommit({
        changedPaths: [],
        expectedRunId: runId,
        readText: () => "{}",
      }),
      /RETAINED_COMMIT_EXPECTED_RUN_ID_INVALID/u,
    );
  }
});

test("trusted retained commit gate rejects noncanonical history run ids in local mode", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-run-id-gate-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  const historyPath = `reports/automation/history/local-run-${taskId}.json`;
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const absoluteHistory = join(root, historyPath);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    writeFileSync(absoluteHistory, `${historyText("local-run")}\n`, "utf8");

    assert.throws(
      () => execFileSync(process.execPath, [gateCli, "--run-id=local"], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          TRUSTED_GIT_BIN: trustedGitBin,
          GITHUB_ACTIONS: "false",
          GITHUB_RUN_ID: "",
        },
      }),
      /RETAINED_COMMIT_HISTORY_PATH_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});