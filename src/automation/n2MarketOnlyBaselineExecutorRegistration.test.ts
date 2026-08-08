import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { createN2MarketOnlyBaselineExecutor } from "./n2MarketOnlyBaselineExecutor";
import {
  EXECUTOR_REGISTRY_VERSION,
  isExecutorImplemented,
  resolveExecutor,
} from "./taskExecutors";

type CatalogTask = {
  taskId?: unknown;
  taskType?: unknown;
  defaultStatus?: unknown;
};

test("market baseline implementation exists but remains outside the runtime registry", () => {
  assert.equal(EXECUTOR_REGISTRY_VERSION, "n2-task-executor-registry-v5");
  assert.equal(typeof createN2MarketOnlyBaselineExecutor, "function");
  assert.equal(isExecutorImplemented("baseline-market"), false);
  assert.equal(resolveExecutor("baseline-market").code, "EXECUTOR_NOT_REGISTERED");
  assert.equal(resolveExecutor("baseline-market").executor, null);
});

test("TASK-N2-020 remains catalog-blocked until private readiness is proven", () => {
  const catalog = JSON.parse(
    readFileSync(resolve(process.cwd(), "automation/task-catalog.json"), "utf8"),
  ) as { tasks?: CatalogTask[] };
  const task = catalog.tasks?.find((candidate) => candidate.taskId === "TASK-N2-020");
  assert.ok(task, "TASK-N2-020 must remain in the canonical catalog");
  assert.equal(task.taskType, "baseline-market");
  assert.equal(task.defaultStatus, "BLOCKED_EXECUTOR_PENDING");
});
