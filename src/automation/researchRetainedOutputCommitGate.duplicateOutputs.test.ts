import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { validateRetainedOutputCommit } from "./researchRetainedOutputCommitGate";

const runId = "12345";
const taskId = "TASK-N2-011";
const output = `reports/automation/retained-outputs/${runId}/${"a".repeat(64)}-report.json`;
const history = `reports/automation/history/${runId}-${taskId}.json`;

test("retained history rejects duplicate output references", () => {
  assert.throws(
    () => validateRetainedOutputCommit({
      changedPaths: [output, history],
      expectedRunId: runId,
      readText: () => JSON.stringify({ runId, taskId, result: "PASS", blocks: [], outputs: [output, output] }),
    }),
    /RETAINED_COMMIT_HISTORY_OUTPUTS_DUPLICATE/u,
  );
});

test("trusted CLI rejects duplicate output references", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-duplicate-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    for (const [relativePath, content] of [
      [output, "{}\n"],
      [history, `${JSON.stringify({ runId, taskId, result: "PASS", blocks: [], outputs: [output, output] })}\n`],
    ] as const) {
      const absolutePath = join(root, relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, "utf8");
    }
    assert.throws(
      () => execFileSync(process.execPath, [gateCli, `--run-id=${runId}`], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, TRUSTED_GIT_BIN: trustedGitBin, GITHUB_ACTIONS: "false", GITHUB_RUN_ID: "" },
      }),
      /RETAINED_COMMIT_HISTORY_OUTPUTS_DUPLICATE/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
