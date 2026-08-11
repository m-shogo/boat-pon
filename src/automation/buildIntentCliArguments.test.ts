import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const script = resolve(repoRoot, "scripts/build-intent-cli.ts");

function run(args: string[], cwd = repoRoot) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("intent builder rejects unknown flags instead of silently applying defaults", () => {
  const result = run([
    "--task-id=TASK-N2-020",
    "--requested-acton=status-only",
    "--expected-authority-sha=0123456789abcdef0123456789abcdef01234567",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown argument: --requested-acton/);
  assert.equal(result.stdout, "");
});

test("intent builder rejects duplicate semantic flags", () => {
  const result = run([
    "--requested-action=dry-run",
    "--requested-action=status-only",
    "--expected-authority-sha=0123456789abcdef0123456789abcdef01234567",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate argument: --requested-action/);
  assert.equal(result.stdout, "");
});

test("intent builder does not substitute local HEAD when origin authority cannot be refreshed", () => {
  const cwd = mkdtempSync(join(tmpdir(), "boat-pon-intent-cli-authority-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
    execFileSync("git", ["config", "user.name", "Boat Pon Test"], { cwd });
    writeFileSync(join(cwd, "fixture.txt"), "fixture\n", "utf8");
    execFileSync("git", ["add", "fixture.txt"], { cwd });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd });

    const result = run([], cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unable to refresh origin\/main authority/);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
