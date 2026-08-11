import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const gateCli = resolve(repoRoot, "scripts/check-research-retained-output-commit.mjs");
const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const runId = "12345";
const taskId = "TASK-N2-011";

function put(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

test("retained commit gate rejects a symlinked history parent directory", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-gate-parent-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-retained-gate-parent-outside-"));
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const historyRelative = `reports/automation/history/${runId}-${taskId}.json`;
    put(root, historyRelative, `${JSON.stringify({ runId, taskId, outputs: [], result: "PASS" })}\n`);
    execFileSync(trustedGitBin, ["add", "--", historyRelative], { cwd: root });

    const historyDir = join(root, "reports/automation/history");
    const outsideHistoryDir = join(outside, "history");
    renameSync(historyDir, outsideHistoryDir);
    symlinkSync(outsideHistoryDir, historyDir, "dir");

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
      /RETAINED_COMMIT_HISTORY_JSON_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
