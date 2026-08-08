import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { runN2MetricsDefinitionExecutor } from "./n2MetricsDefinitionExecutor";
import { isExecutorImplemented, resolveExecutor } from "./taskExecutors";

type CatalogTask = {
  taskId?: unknown;
  taskType?: unknown;
  executor?: unknown;
  expectedOutputs?: unknown;
  defaultStatus?: unknown;
};

test("metrics definition helper exists without registering the canonical N2-030 executor", () => {
  assert.equal(typeof runN2MetricsDefinitionExecutor, "function");
  assert.equal(isExecutorImplemented("evaluation-metrics"), false);
  assert.equal(resolveExecutor("evaluation-metrics").code, "EXECUTOR_NOT_REGISTERED");
  assert.equal(resolveExecutor("evaluation-metrics").executor, null);
});

test("TASK-N2-030 keeps its canonical contract blocked until a real evaluation executor exists", () => {
  const catalog = JSON.parse(
    readFileSync(resolve(process.cwd(), "automation/task-catalog.json"), "utf8"),
  ) as { tasks?: CatalogTask[] };
  const task = catalog.tasks?.find((candidate) => candidate.taskId === "TASK-N2-030");
  assert.ok(task, "TASK-N2-030 must remain in the canonical catalog");
  assert.equal(task.taskType, "evaluation-metrics");
  assert.equal(task.executor, "evaluation-metrics");
  assert.deepEqual(task.expectedOutputs, ["reports/n2/n2-evaluation-metrics.json"]);
  assert.equal(task.defaultStatus, "BLOCKED_EXECUTOR_PENDING");
});
