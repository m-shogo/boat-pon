import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const gateCli = resolve(repoRoot, "scripts/check-research-retained-output-commit.mjs");
const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();

assert.ok(trustedGitBin.startsWith("/"), "test runtime must resolve git to an absolute path");

test("trusted retained-history CLI rejects invalid UTF-8 that would otherwise decode with replacement characters", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-utf8-"));
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    const runId = "12345";
    const taskId = "TASK-N2-011";
    const history = `reports/automation/history/${runId}-${taskId}.json`;
    const absoluteHistory = join(root, history);
    mkdirSync(dirname(absoluteHistory), { recursive: true });

    const prefix = Buffer.from(
      JSON.stringify({ runId, taskId, outputs: [], result: "PASS", note: "" }).replace('"note":""', '"note":"'),
      "utf8",
    );
    const suffix = Buffer.from('"}\n', "utf8");
    writeFileSync(absoluteHistory, Buffer.concat([prefix, Buffer.from([0x80]), suffix]));

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
  }
});
