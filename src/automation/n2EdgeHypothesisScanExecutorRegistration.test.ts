import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { runN2EdgeHypothesisScanExecutor } from "./n2EdgeHypothesisScanExecutor";
import { isExecutorImplemented, resolveExecutor } from "./taskExecutors";

type CatalogTask = {
  taskId?: unknown;
  taskType?: unknown;
  executor?: unknown;
  dependencies?: unknown;
  expectedOutputs?: unknown;
  defaultStatus?: unknown;
};

test("canonical edge-hypothesis-scan implementation exists but remains outside runtime registry", () => {
  assert.equal(typeof runN2EdgeHypothesisScanExecutor, "function");
  assert.equal(isExecutorImplemented("edge-hypothesis-scan"), false);
  assert.equal(resolveExecutor("edge-hypothesis-scan").code, "EXECUTOR_NOT_REGISTERED");
  assert.equal(resolveExecutor("edge-hypothesis-scan").executor, null);
});

test("TASK-N2-040 keeps canonical blocked contract until N2-030 actually passes", () => {
  const catalog = JSON.parse(
    readFileSync(resolve(process.cwd(), "automation/task-catalog.json"), "utf8"),
  ) as { tasks?: CatalogTask[] };
  const task = catalog.tasks?.find((candidate) => candidate.taskId === "TASK-N2-040");
  assert.ok(task);
  assert.equal(task.taskType, "edge-hypothesis-scan");
  assert.equal(task.executor, "edge-hypothesis-scan");
  assert.deepEqual(task.dependencies, ["TASK-N2-030"]);
  assert.deepEqual(task.expectedOutputs, ["reports/n2/n2-edge-hypothesis-scan.json"]);
  assert.equal(task.defaultStatus, "BLOCKED_EXECUTOR_PENDING");
});
