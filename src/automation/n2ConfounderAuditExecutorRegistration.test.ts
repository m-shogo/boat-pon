import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { runN2ConfounderAuditExecutor } from "./n2ConfounderAuditExecutor";
import { isExecutorImplemented, resolveExecutor } from "./taskExecutors";

type CatalogTask = {
  taskId?: unknown;
  taskType?: unknown;
  executor?: unknown;
  dependencies?: unknown;
  expectedOutputs?: unknown;
  defaultStatus?: unknown;
};

test("canonical confounder-audit implementation exists but remains outside runtime registry", () => {
  assert.equal(typeof runN2ConfounderAuditExecutor, "function");
  assert.equal(isExecutorImplemented("confounder-audit"), false);
  assert.equal(resolveExecutor("confounder-audit").code, "EXECUTOR_NOT_REGISTERED");
  assert.equal(resolveExecutor("confounder-audit").executor, null);
});

test("TASK-N2-042 keeps canonical blocked contract until N2-041 actually passes", () => {
  const catalog = JSON.parse(
    readFileSync(resolve(process.cwd(), "automation/task-catalog.json"), "utf8"),
  ) as { tasks?: CatalogTask[] };
  const task = catalog.tasks?.find((candidate) => candidate.taskId === "TASK-N2-042");
  assert.ok(task);
  assert.equal(task.taskType, "confounder-audit");
  assert.equal(task.executor, "confounder-audit");
  assert.deepEqual(task.dependencies, ["TASK-N2-041"]);
  assert.deepEqual(task.expectedOutputs, ["reports/n2/n2-confounder-audit.json"]);
  assert.equal(task.defaultStatus, "BLOCKED_EXECUTOR_PENDING");
});
