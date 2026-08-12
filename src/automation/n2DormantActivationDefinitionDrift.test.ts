import assert from "node:assert/strict";
import test from "node:test";

import { N2_DORMANT_TASKS } from "./n2DormantActivationContract";
import { findN2DormantTaskDefinitionDrift } from "./n2DormantActivationDefinitionDrift";
import type { QueueState, TaskCatalog } from "./taskCatalog";

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
      taskType: "baseline-market",
      executor: "baseline-market",
      safetyLevel: "L0",
      dependencies: [],
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
