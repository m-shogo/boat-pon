import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const runId = "12345";
const taskId = "TASK-N2-011";
const historyPath = `reports/automation/history/${runId}-${taskId}.json`;
const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();

test("trusted retained-output gate rejects symlinked history evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-history-link-root-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-retained-history-link-target-"));
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const target = join(outside, "history.json");
    writeFileSync(target, `${JSON.stringify({ runId, taskId, result: "PASS", blocks: [], outputs: [] })}\n`, "utf8");
    const link = join(root, historyPath);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);

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
