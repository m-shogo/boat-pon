import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve(process.cwd(), "scripts/build-research-request.mjs");

function validEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TASK_ID: "TASK-N2-020",
    REQUESTED_ACTION: "status-only",
    SAFETY_LEVEL: "L0",
    AUTHORITY_SHA: "0123456789abcdef0123456789abcdef01234567",
    MAX_DURATION: "1800",
    REQUEST_REFERENCE: "safe-read-test",
    RUN_ID: "safe-read-test",
    ACTOR: "test-actor",
  };
}

test("workflow request builder rejects a symlinked task queue", () => {
  const cwd = mkdtempSync(join(tmpdir(), "boat-pon-build-request-queue-symlink-"));
  try {
    const automationDir = join(cwd, "automation");
    mkdirSync(automationDir, { recursive: true });
    const target = join(cwd, "queue-target.json");
    writeFileSync(target, "{\"tasks\":[]}\n", "utf8");
    symlinkSync(target, join(automationDir, "task-queue.json"));

    const result = spawnSync(process.execPath, [script], {
      cwd,
      env: validEnv(),
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /task queue/u);
    assert.match(result.stderr, /symlink forbidden/u);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
