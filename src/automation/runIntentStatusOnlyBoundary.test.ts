import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("status-only resolves current task state before execution-readiness gates", () => {
  const source = readFileSync("scripts/run-intent-task.ts", "utf8");
  const statusOnly = source.indexOf("if (statusOnly) {");
  const readiness = source.indexOf('if (task.status !== "READY")');
  const claim = source.indexOf('updateState(task.taskId, { status: "CLAIMED"');

  assert.ok(statusOnly >= 0, "status-only read-only branch must exist");
  assert.ok(readiness > statusOnly, "status-only must return before the READY execution gate");
  assert.ok(claim > statusOnly, "status-only must return before an attempt is claimed");

  const branch = source.slice(statusOnly, readiness);
  assert.match(branch, /taskStatus:\s*task\.status/);
  assert.match(branch, /staleDefinition:\s*task\.staleDefinition/);
  assert.doesNotMatch(branch, /updateState\(/, "status-only must not mutate queue state");
  assert.doesNotMatch(branch, /executor\(/, "status-only must not invoke an executor");
});

test("status-only is distinct from execution dry-run semantics", () => {
  const source = readFileSync("scripts/run-intent-task.ts", "utf8");

  assert.match(source, /const statusOnly = request\.requestedAction === "status-only";/);
  assert.match(
    source,
    /const dryRun = !statusOnly && \(request\.dryRun === true \|\| request\.requestedAction === "dry-run"\);/,
    "status-only must take the dedicated read-only branch even when its contract includes dryRun=true",
  );
});
