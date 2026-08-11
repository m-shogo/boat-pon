import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const commitScript = resolve(repoRoot, "scripts/automation-commit.sh");
const trustedGitBin = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const trustedNodeBin = process.execPath;

test("automation commit rejects an allowlisted symlink before retained-output reads", () => {
  const cwd = mkdtempSync(join(tmpdir(), "boat-pon-automation-commit-symlink-"));
  const privateFile = join(tmpdir(), `boat-pon-private-${process.pid}-${Date.now()}.json`);
  try {
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
    execFileSync("git", ["config", "user.name", "Boat Pon Test"], { cwd });
    writeFileSync(join(cwd, "README.md"), "base\n");
    execFileSync("git", ["add", "."], { cwd });
    execFileSync("git", ["commit", "-qm", "base"], { cwd });

    writeFileSync(privateFile, '{"private":"must-not-be-read"}\n');
    mkdirSync(join(cwd, "reports/automation/history"), { recursive: true });
    symlinkSync(privateFile, join(cwd, "reports/automation/history/123-TASK-TEST.json"));

    const result = spawnSync("bash", [commitScript], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        RUN_ID: "123",
        TRUSTED_GIT_BIN: trustedGitBin,
        TRUSTED_NODE_BIN: trustedNodeBin,
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /refusing to commit through symbolic link/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(privateFile, { force: true });
  }
});
