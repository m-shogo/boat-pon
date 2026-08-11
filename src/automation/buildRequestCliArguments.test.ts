import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(process.cwd());
const script = resolve(root, "scripts/build-request-cli.ts");

function run(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: root,
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
