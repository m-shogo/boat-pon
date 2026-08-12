import assert from "node:assert/strict";
import test from "node:test";

import { N2_DORMANT_TASKS } from "./n2DormantActivationContract";
import { findN2DormantTaskDefinitionDrift } from "./n2DormantActivationDefinitionDrift";
import type { QueueState, TaskCatalog } from "./taskCatalog";

const taskTypes: Record<(typeof N2_DORMANT_TASKS)[number], string> = {
  "TASK-N2-020": "baseline-market",
  "TASK-N2-021": "baseline-historical",
  "TASK-N2-022": "baseline-common-cohort",
  "TASK-N2-030": "evaluation-metrics",
  "TASK-N2-040": "edge-hypothesis-scan",
  "TASK-N2-041": "edge-historical-test",
  "TASK-N2-042": "confounder-audit",
};

const dependencies: Record<(typeof N2_DORMANT_TASKS)[number], string[]> = {
  "TASK-N2-020": ["TASK-N2-011", "TASK-N2-005"],
  "TASK-N2-021": ["TASK-N2-011", "TASK-N2-005"],
  "TASK-N2-022": ["TASK-N2-020", "TASK-N2-021"],
  "TASK-N2-030": ["TASK-N2-022"],
  "TASK-N2-040": ["TASK-N2-030"],
  "TASK-N2-041": ["TASK-N2-040"],
  "TASK-N2-042": ["TASK-N2-041"],
};

function catalog(): TaskCatalog {
  return {
    catalogSchemaVersion: "research-task-catalog-v1",
    catalogVersion: "v1",
    updatedAt: "2026-08-12T00:00:00Z",
    tasks: N2_DORMANT_TASKS.map((taskId) => ({
      taskId,
      taskDefinitionVersion: 2,
      title: "market baseline",
      objective: "o",
      taskType: taskTypes[taskId],
      executor: taskTypes[taskId],
      safetyLevel: "L0",
      dependencies: [...dependencies[taskId]],
      maxDurationSeconds: 3600,
      expectedInputs: [],
      expectedOutputs: [],
      estimatedDurationSeconds: 60,
      defaultStatus: "BLOCKED_EXECUTOR_PENDING",
      valueOfInformation: "v",
      invalidationCondition: "i",
    })),
  };
}

function queue(taskDefinitionVersion = 2): QueueState {
  return {
    stateSchemaVersion: "research-queue-state-v1",
    stateVersion: 1,
    catalogVersion: "v1",
    updatedAt: "2026-08-12T00:00:00Z",
    tasks: Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, {
      status: "BLOCKED_EXECUTOR_PENDING",
      taskDefinitionVersion,
      authoritySha: null,
      attemptCount: 0,
      maxAttempts: 3,
      evidenceLinks: [],
      resultDigest: null,
      lastFailure: null,
      checkpoint: null,
      updatedAt: "2026-08-12T00:00:00Z",
    }])),
  };
}

test("N2 activation rejects stale queue definition version", () => {
  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(catalog(), queue(1)),
    N2_DORMANT_TASKS.map((taskId) => `${taskId}:TASK_DEFINITION_VERSION_MISMATCH`),
  );
});

test("N2 activation accepts matching definition version", () => {
  assert.deepEqual(findN2DormantTaskDefinitionDrift(catalog(), queue()), []);
});

test("N2 activation rejects future queue definition version too", () => {
  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(catalog(), queue(3)),
    N2_DORMANT_TASKS.map((taskId) => `${taskId}:TASK_DEFINITION_VERSION_MISMATCH`),
  );
});

test("N2 activation rejects queue state from a different catalog version", () => {
  const mismatchedState = queue();
  mismatchedState.catalogVersion = "v0";
  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(catalog(), mismatchedState),
    ["CATALOG_VERSION_MISMATCH"],
  );
});

test("N2 activation fails closed before readiness when a catalog task is missing", () => {
  const missingCatalogTask = catalog();
  missingCatalogTask.tasks = missingCatalogTask.tasks.filter((task) => task.taskId !== "TASK-N2-021");
  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(missingCatalogTask, queue()),
    ["TASK-N2-021:CATALOG_TASK_MISSING"],
  );
});

test("N2 activation fails closed before readiness when a queue task is missing", () => {
  const missingQueueTask = queue();
  delete missingQueueTask.tasks["TASK-N2-021"];
  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(catalog(), missingQueueTask),
    ["TASK-N2-021:QUEUE_TASK_MISSING"],
  );
});

test("N2 activation fails closed before readiness when a catalog task type drifts", () => {
  const mismatchedCatalog = catalog();
  const task = mismatchedCatalog.tasks.find((entry) => entry.taskId === "TASK-N2-020");
  assert.ok(task);
  task.taskType = "baseline-historical";

  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(mismatchedCatalog, queue()),
    ["TASK-N2-020:CATALOG_TASK_TYPE_MISMATCH"],
  );
});

test("N2 activation fails closed before readiness when a catalog executor drifts", () => {
  const mismatchedCatalog = catalog();
  const task = mismatchedCatalog.tasks.find((entry) => entry.taskId === "TASK-N2-020");
  assert.ok(task);
  task.executor = "baseline-historical";

  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(mismatchedCatalog, queue()),
    ["TASK-N2-020:CATALOG_EXECUTOR_MISMATCH"],
  );
});

test("N2 activation fails closed before readiness when catalog dependencies drift", () => {
  const mismatchedCatalog = catalog();
  const task = mismatchedCatalog.tasks.find((entry) => entry.taskId === "TASK-N2-022");
  assert.ok(task);
  task.dependencies = ["TASK-N2-020"];

  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(mismatchedCatalog, queue()),
    ["TASK-N2-022:CATALOG_DEPENDENCIES_MISMATCH"],
  );
});
