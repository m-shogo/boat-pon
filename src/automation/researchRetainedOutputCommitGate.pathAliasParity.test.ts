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
const authoritySha = "c".repeat(40);

function history(outputs: string[]): string {
  return JSON.stringify({ runId, taskId, result: "PASS", blocks: [], executed: true, outputDigest, summary: {}, idempotencyKey, authoritySha, outputs });
}

test("retained gate rejects noncanonical output path aliases", () => {
  assert.doesNotThrow(() => validateRetainedOutputCommit({ changedPaths: [historyPath], expectedRunId: runId, readText: () => history(["reports/n2/report.json"]) }));
  for (const alias of ["reports/n2/./report.json", "reports/n2//report.json", "reports/n2/report.json/"]) {
    assert.throws(
      () => validateRetainedOutputCommit({ changedPaths: [historyPath], expectedRunId: runId, readText: () => history(["reports/n2/report.json", alias]) }),
      /RETAINED_COMMIT_HISTORY_OUTPUT_PATH_NOT_APPROVED/u,
    );
  }
});

test("trusted CLI rejects output path aliases before retained history commit", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-output-path-alias-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const absoluteHistory = join(root, historyPath);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    writeFileSync(absoluteHistory, `${history(["reports/n2/report.json", "reports/n2/./report.json"])}\n`, "utf8");
    assert.throws(() => execFileSync(process.execPath, [gateCli, `--run-id=${runId}`], { cwd: root, encoding: "utf8", env: { ...process.env, TRUSTED_GIT_BIN: trustedGitBin, GITHUB_ACTIONS: "false", GITHUB_RUN_ID: "" } }), /RETAINED_COMMIT_HISTORY_OUTPUT_PATH_NOT_APPROVED/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});