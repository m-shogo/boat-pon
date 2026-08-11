import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const gateCli = resolve(repoRoot, "scripts/check-research-retained-output-commit.mjs");
const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
assert.ok(trustedGitBin.startsWith("/"), "test runtime must resolve git to an absolute path");

test("trusted retained-output gate rejects repo-local worktree redirection", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-gate-root-"));
  const redirected = mkdtempSync(join(tmpdir(), "boat-pon-retained-gate-redirected-"));
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    execFileSync(trustedGitBin, ["config", "core.worktree", redirected], { cwd: root });

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
      /RETAINED_COMMIT_WORKTREE_MISMATCH/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(redirected, { recursive: true, force: true });
  }
});
