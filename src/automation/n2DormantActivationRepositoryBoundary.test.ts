import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { N2_DORMANT_TASKS } from "./n2DormantActivationContract";
import { isExecutorImplemented, resolveExecutor } from "./taskExecutors";

type CatalogTask = {
  taskId?: unknown;
  taskType?: unknown;
  defaultStatus?: unknown;
};

const expectedTaskTypes: Record<(typeof N2_DORMANT_TASKS)[number], string> = {
  "TASK-N2-020": "baseline-market",
  "TASK-N2-021": "baseline-historical",
  "TASK-N2-022": "baseline-common-cohort",
  "TASK-N2-030": "metrics-eval",
};

test("all prepared N2 executors remain dormant while catalog says executor pending", () => {
  const catalog = JSON.parse(
    readFileSync(resolve(process.cwd(), "automation/task-catalog.json"), "utf8"),
  ) as { tasks?: CatalogTask[] };

  for (const taskId of N2_DORMANT_TASKS) {
    const task = catalog.tasks?.find((candidate) => candidate.taskId === taskId);
    assert.ok(task, `${taskId} must remain in canonical task catalog`);
    assert.equal(task.taskType, expectedTaskTypes[taskId]);
    assert.equal(task.defaultStatus, "BLOCKED_EXECUTOR_PENDING");
    assert.equal(isExecutorImplemented(expectedTaskTypes[taskId]), false);
    assert.equal(resolveExecutor(expectedTaskTypes[taskId]).code, "EXECUTOR_NOT_REGISTERED");
  }
});
