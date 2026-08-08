import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { createN2CommonCohortBaselineExecutor } from "./n2CommonCohortBaselineExecutor";
import { isExecutorImplemented, resolveExecutor } from "./taskExecutors";

type CatalogTask = {
  taskId?: unknown;
  taskType?: unknown;
  defaultStatus?: unknown;
};

test("common cohort implementation remains outside the runtime registry", () => {
  assert.equal(typeof createN2CommonCohortBaselineExecutor, "function");
  assert.equal(isExecutorImplemented("baseline-common-cohort"), false);
  assert.equal(resolveExecutor("baseline-common-cohort").code, "EXECUTOR_NOT_REGISTERED");
  assert.equal(resolveExecutor("baseline-common-cohort").executor, null);
});

test("TASK-N2-022 remains blocked until N2-020 and N2-021 complete", () => {
  const catalog = JSON.parse(
    readFileSync(resolve(process.cwd(), "automation/task-catalog.json"), "utf8"),
  ) as { tasks?: CatalogTask[] };
  const task = catalog.tasks?.find((candidate) => candidate.taskId === "TASK-N2-022");
  assert.ok(task, "TASK-N2-022 must remain in the canonical catalog");
  assert.equal(task.taskType, "baseline-common-cohort");
  assert.equal(task.defaultStatus, "BLOCKED_EXECUTOR_PENDING");
});
