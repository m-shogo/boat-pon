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
const digest = "a".repeat(64);
const idempotencyKey = "b".repeat(64);
const authoritySha = "c".repeat(40);
const noncanonicalRetainedPath = `reports/automation/retained-outputs/${runId}/${digest}-not canonical.json`;

function historyText(output = noncanonicalRetainedPath): string {
  return JSON.stringify({ runId, taskId, result: "PASS", blocks: [], executed: true, outputDigest: digest, idempotencyKey, authoritySha, outputs: [output] });
}

test("retained commit gate rejects filenames the canonical writer cannot produce", () => {
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [historyPath, noncanonicalRetainedPath],
      expectedRunId: runId,
      readText: () => historyText(),
    }),
    /RETAINED_COMMIT_HISTORY_RETAINED_PATH_INVALID/u,
  );
});

test("retained commit gate rejects dot-only basenames the canonical writer rejects", () => {
  for (const suffix of [".", ".."]) {
    const retainedPath = `reports/automation/retained-outputs/${runId}/${digest}-${suffix}`;
    assert.throws(
      () => validateRetainedOutputCommit({
        changedPaths: [historyPath, retainedPath],
        expectedRunId: runId,
        readText: () => historyText(retainedPath),
      }),
      /RETAINED_COMMIT_HISTORY_RETAINED_PATH_INVALID/u,
    );
  }
});

test("trusted retained commit gate rejects noncanonical retained filenames", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-canonical-gate-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const absoluteHistory = join(root, historyPath);
    const absoluteRetained = join(root, noncanonicalRetainedPath);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    mkdirSync(dirname(absoluteRetained), { recursive: true });
    writeFileSync(absoluteHistory, `${historyText()}\n`, "utf8");
    writeFileSync(absoluteRetained, "retained evidence\n", "utf8");

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
      /RETAINED_COMMIT_PATH_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("trusted retained commit gate rejects a dot-only retained basename", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-dot-gate-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  const retainedPath = `reports/automation/retained-outputs/${runId}/${digest}-.`;
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const absoluteHistory = join(root, historyPath);
    const absoluteRetained = join(root, retainedPath);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    mkdirSync(dirname(absoluteRetained), { recursive: true });
    writeFileSync(absoluteHistory, `${historyText(retainedPath)}\n`, "utf8");
    writeFileSync(absoluteRetained, "retained evidence\n", "utf8");

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
      /RETAINED_COMMIT_PATH_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});