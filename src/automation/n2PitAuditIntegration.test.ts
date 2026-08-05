import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isExecutorImplemented } from "./taskExecutors";

test("N2-011 catalog, registry and phase mapping are aligned", () => {
  const catalog = JSON.parse(readFileSync("automation/task-catalog.json", "utf8")) as {
    catalogVersion: string;
    tasks: Array<Record<string, unknown>>;
  };
  const task = catalog.tasks.find((candidate) => candidate.taskId === "TASK-N2-011");
  assert.ok(task);
  assert.equal(catalog.catalogVersion, "2026-08-05-n2-governance-v4");
  assert.equal(task.taskDefinitionVersion, 3);
  assert.equal(task.defaultStatus, "READY");
  assert.equal(task.taskType, "pit-audit");
  assert.deepEqual(task.dependencies, ["TASK-N2-010"]);
  assert.deepEqual(task.expectedOutputs, ["reports/n2/n2-pit-audit.json"]);
  assert.match(String(task.invalidationCondition), /core-digest\/PIT-envelope/);
  assert.equal(isExecutorImplemented(String(task.executor)), true);

  const mapping = JSON.parse(readFileSync("automation/phase-mapping.json", "utf8")) as {
    legacyTaskAliases: Array<Record<string, unknown>>;
  };
  const alias = mapping.legacyTaskAliases.find((candidate) => candidate.legacy === "TASK-N2-011");
  assert.equal(alias?.status, "implemented_ready");
});

test("one-shot workflow materializes the exact N2-010 manifest outside the worktree", () => {
  const workflow = readFileSync(".github/workflows/boat-pon-intent-dispatch.yml", "utf8");
  assert.match(workflow, /origin\/\$BRANCH:reports\/n2\/n2-dataset-manifest\.json/);
  assert.match(workflow, /\$RUNNER_TEMP\/n2-dataset-manifest\.json/);
  assert.match(workflow, /BOAT_PON_N2_DATASET_MANIFEST_PATH:/);
  assert.doesNotMatch(workflow, /> reports\/n2\/n2-dataset-manifest\.json/);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
});

test("automation evidence allowlist includes only the N2 PIT report prefix", () => {
  const commitScript = readFileSync("scripts/automation-commit.sh", "utf8");
  assert.match(commitScript, /reports\/n2\/n2-pit-audit\./);
  assert.doesNotMatch(commitScript, /reports\/n2\/.*\*|reports\/n2\/"/);
  assert.match(commitScript, /\.sqlite\|\*\.sqlite-/);
});
