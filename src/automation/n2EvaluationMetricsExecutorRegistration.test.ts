import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { runN2EvaluationMetricsExecutor } from "./n2EvaluationMetricsExecutor";
import { isExecutorImplemented, resolveExecutor } from "./taskExecutors";

type CatalogTask = {
  taskId?: unknown;
  taskType?: unknown;
  executor?: unknown;
  dependencies?: unknown;
  expectedOutputs?: unknown;
  defaultStatus?: unknown;
};

test("canonical evaluation-metrics implementation exists but remains outside runtime registry", () => {
  assert.equal(typeof runN2EvaluationMetricsExecutor, "function");
  assert.equal(isExecutorImplemented("evaluation-metrics"), false);
  assert.equal(resolveExecutor("evaluation-metrics").code, "EXECUTOR_NOT_REGISTERED");
  assert.equal(resolveExecutor("evaluation-metrics").executor, null);
});

test("TASK-N2-030 keeps canonical blocked contract until N2-022 actually passes", () => {
  const catalog = JSON.parse(
    readFileSync(resolve(process.cwd(), "automation/task-catalog.json"), "utf8"),
  ) as { tasks?: CatalogTask[] };
  const task = catalog.tasks?.find((candidate) => candidate.taskId === "TASK-N2-030");
  assert.ok(task);
  assert.equal(task.taskType, "evaluation-metrics");
  assert.equal(task.executor, "evaluation-metrics");
  assert.deepEqual(task.dependencies, ["TASK-N2-022"]);
  assert.deepEqual(task.expectedOutputs, ["reports/n2/n2-evaluation-metrics.json"]);
  assert.equal(task.defaultStatus, "BLOCKED_EXECUTOR_PENDING");
});
