import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const runId = "12345";
const taskId = "TASK-N2-011";
const history = `reports/automation/history/${runId}-${taskId}.json`;
const approved = "reports/n2/example.json";
const unapproved = "private/raw-t5.json";
const traversal = "reports/n2/../private/raw-t5.json";

function historyText(outputs: string[]): string {
  return JSON.stringify({ runId, taskId, result: "PASS", blocks: [], executed: true, outputs });
}

test("retained history accepts only durable-audit approved output roots", () => {
  assert.doesNotThrow(() => validateRetainedOutputCommit({
    changedPaths: [history],
    expectedRunId: runId,
    readText: () => historyText([approved]),
  }));

  for (const output of [unapproved, traversal, "/reports/n2/absolute.json", history]) {
    assert.throws(
      () => validateRetainedOutputCommit({
        changedPaths: [history],
        expectedRunId: runId,
        readText: () => historyText([output]),
      }),
      /RETAINED_COMMIT_HISTORY_OUTPUT_PATH_NOT_APPROVED/u,
      output,
    );
  }
});

test("trusted CLI rejects an append-only history with an unapproved output reference", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-output-root-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const absoluteHistory = join(root, history);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    writeFileSync(absoluteHistory, `${historyText([unapproved])}\n`, "utf8");

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
      /RETAINED_COMMIT_HISTORY_OUTPUT_PATH_NOT_APPROVED/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("trusted CLI rejects history self-reference as durable output", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-history-self-output-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const absoluteHistory = join(root, history);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    writeFileSync(absoluteHistory, `${historyText([history])}\n`, "utf8");

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
      /RETAINED_COMMIT_HISTORY_OUTPUT_PATH_NOT_APPROVED/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
