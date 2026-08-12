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
const validIdempotencyKey = "b".repeat(64);
const authoritySha = "c".repeat(40);

function history(idempotencyKey: unknown): string {
  return JSON.stringify({
    runId,
    taskId,
    result: "PASS",
    blocks: [],
    executed: true,
    outputDigest,
    idempotencyKey,
    authoritySha,
    outputs: [],
  });
}

test("retained gate requires a canonical lowercase sha256 idempotency key", () => {
  for (const idempotencyKey of [undefined, "b".repeat(63), "B".repeat(64), `${validIdempotencyKey}0`]) {
    assert.throws(
      () => validateRetainedOutputCommit({
        changedPaths: [historyPath],
        expectedRunId: runId,
        readText: () => history(idempotencyKey),
      }),
      /RETAINED_COMMIT_HISTORY_IDEMPOTENCY_KEY_INVALID/u,
    );
  }
  assert.doesNotThrow(() => validateRetainedOutputCommit({
    changedPaths: [historyPath],
    expectedRunId: runId,
    readText: () => history(validIdempotencyKey),
  }));
});

test("trusted CLI rejects retained history with a malformed idempotency key", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-idempotency-key-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const absoluteHistory = join(root, historyPath);
    mkdirSync(dirname(absoluteHistory), { recursive: true });
    writeFileSync(absoluteHistory, `${history("not-a-sha256")}\n`, "utf8");

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
      /RETAINED_COMMIT_HISTORY_IDEMPOTENCY_KEY_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});