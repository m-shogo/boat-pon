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

function history(result: string, blocks: unknown): string {
  return JSON.stringify({ runId, taskId, result, blocks, executed: true, outputDigest, idempotencyKey, outputs: [] });
}

function validate(result: string, blocks: unknown): void {
  validateRetainedOutputCommit({
    changedPaths: [historyPath],
    expectedRunId: runId,
    readText: () => history(result, blocks),
  });
}

test("retained gate rejects terminal result/block contradictions", () => {
  assert.throws(() => validate("PASS", ["unexpected"]), /RETAINED_COMMIT_HISTORY_PASS_HAS_BLOCKS/u);
  assert.throws(() => validate("BLOCKED", []), /RETAINED_COMMIT_HISTORY_NONPASS_BLOCKS_EMPTY/u);
  assert.throws(() => validate("FAILED", []), /RETAINED_COMMIT_HISTORY_NONPASS_BLOCKS_EMPTY/u);
  assert.doesNotThrow(() => validate("PASS", []));
  assert.doesNotThrow(() => validate("BLOCKED", ["dependency-not-ready"]));
});

test("retained gate requires blocks to be a string array like durable history validation", () => {
  assert.throws(() => validate("PASS", undefined), /RETAINED_COMMIT_HISTORY_BLOCKS_INVALID/u);
  assert.throws(() => validate("BLOCKED", "dependency-not-ready"), /RETAINED_COMMIT_HISTORY_BLOCKS_INVALID/u);
  assert.throws(() => validate("CONDITIONAL", [42]), /RETAINED_COMMIT_HISTORY_BLOCKS_INVALID/u);
});

test("trusted CLI rejects contradictory and malformed terminal blocks before commit", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-block-parity-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const absoluteHistory = join(root, historyPath);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    writeFileSync(absoluteHistory, `${history("PASS", ["unexpected"])}\n`, "utf8");

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
      /RETAINED_COMMIT_HISTORY_PASS_HAS_BLOCKS/u,
    );

    writeFileSync(absoluteHistory, `${history("BLOCKED", "dependency-not-ready")}\n`, "utf8");
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
      /RETAINED_COMMIT_HISTORY_BLOCKS_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
