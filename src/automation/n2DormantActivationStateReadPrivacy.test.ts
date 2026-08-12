import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("N2 activation planner does not expose a private state path on read failure", () => {
  const privateStatePath = join(
    tmpdir(),
    "boat-pon-private-state-do-not-log",
    "secret-task-queue-state.json",
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve(process.cwd(), "scripts/report-n2-dormant-activation-plan.ts"),
      "--state",
      privateStatePath,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 3);
  const report = JSON.parse(result.stdout) as { blockers?: unknown };
  assert.deepEqual(report.blockers, ["QUEUE_STATE_READ_FAILED"]);
  assert.doesNotMatch(result.stdout, new RegExp(privateStatePath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});
