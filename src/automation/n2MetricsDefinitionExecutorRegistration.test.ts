import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { runN2MetricsDefinitionExecutor } from "./n2MetricsDefinitionExecutor";
import { isExecutorImplemented, resolveExecutor } from "./taskExecutors";

type CatalogTask = {
  taskId?: unknown;
  taskType?: unknown;
  defaultStatus?: unknown;
};

test("metrics definition implementation remains outside the runtime registry", () => {
  assert.equal(typeof runN2MetricsDefinitionExecutor, "function");
  assert.equal(isExecutorImplemented("metrics-eval"), false);
  assert.equal(resolveExecutor("metrics-eval").code, "EXECUTOR_NOT_REGISTERED");
  assert.equal(resolveExecutor("metrics-eval").executor, null);
});

test("TASK-N2-030 remains blocked until N2-022 actually passes", () => {
  const catalog = JSON.parse(
    readFileSync(resolve(process.cwd(), "automation/task-catalog.json"), "utf8"),
  ) as { tasks?: CatalogTask[] };
  const task = catalog.tasks?.find((candidate) => candidate.taskId === "TASK-N2-030");
  assert.ok(task, "TASK-N2-030 must remain in the canonical catalog");
  assert.equal(task.taskType, "metrics-eval");
  assert.equal(task.defaultStatus, "BLOCKED_EXECUTOR_PENDING");
});
