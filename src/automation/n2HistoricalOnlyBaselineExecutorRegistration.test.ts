import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { createN2HistoricalOnlyBaselineExecutor } from "./n2HistoricalOnlyBaselineExecutor";
import { isExecutorImplemented, resolveExecutor } from "./taskExecutors";

type CatalogTask = {
  taskId?: unknown;
  taskType?: unknown;
  defaultStatus?: unknown;
};

test("historical baseline implementation remains outside the runtime registry", () => {
  assert.equal(typeof createN2HistoricalOnlyBaselineExecutor, "function");
  assert.equal(isExecutorImplemented("baseline-historical"), false);
  assert.equal(resolveExecutor("baseline-historical").code, "EXECUTOR_NOT_REGISTERED");
  assert.equal(resolveExecutor("baseline-historical").executor, null);
});

test("TASK-N2-021 remains blocked until the common private cohort is ready", () => {
  const catalog = JSON.parse(
    readFileSync(resolve(process.cwd(), "automation/task-catalog.json"), "utf8"),
  ) as { tasks?: CatalogTask[] };
  const task = catalog.tasks?.find((candidate) => candidate.taskId === "TASK-N2-021");
  assert.ok(task, "TASK-N2-021 must remain in the canonical catalog");
  assert.equal(task.taskType, "baseline-historical");
  assert.equal(task.defaultStatus, "BLOCKED_EXECUTOR_PENDING");
});
