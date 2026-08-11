import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(process.cwd());
const script = resolve(root, "scripts/build-request-cli.ts");
const tsxLoader = import.meta.resolve("tsx");

function run(args: string[], cwd = root) {
  return spawnSync(process.execPath, ["--import", tsxLoader, script, ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("legacy request builder rejects unknown flags instead of falling back to an execution default", () => {
  const result = run([
    "--task-id=TASK-N2-020",
    "--requested-acton=status-only",
    "--authority-sha=0123456789abcdef0123456789abcdef01234567",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown argument: --requested-acton/);
  assert.equal(result.stdout, "");
});

test("legacy request builder rejects duplicate semantic flags", () => {
  const result = run([
    "--task-id=TASK-N2-020",
    "--requested-action=status-only",
    "--requested-action=run-task",
    "--authority-sha=0123456789abcdef0123456789abcdef01234567",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate argument: --requested-action/);
  assert.equal(result.stdout, "");
});

test("legacy request builder does not use a stale origin/main ref when fetch fails", () => {
  const cwd = mkdtempSync(join(tmpdir(), "boat-pon-request-cli-authority-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
    execFileSync("git", ["config", "user.name", "Boat Pon Test"], { cwd });
    writeFileSync(join(cwd, "fixture.txt"), "fixture\n", "utf8");
    execFileSync("git", ["add", "fixture.txt"], { cwd });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd });
    const localHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", localHead], { cwd });
    execFileSync("git", ["remote", "add", "origin", "https://invalid.invalid/boat-pon.git"], { cwd });

    const result = run(["--task-id=TASK-N2-020"], cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unable to refresh origin\/main authority/);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
