import assert from "node:assert/strict";
import test from "node:test";

import { findN2DormantTaskDefinitionDrift } from "./n2DormantActivationDefinitionDrift";
import type { QueueState, TaskCatalog } from "./taskCatalog";

function catalog(): TaskCatalog {
  return {
    catalogSchemaVersion: "research-task-catalog-v1",
    catalogVersion: "v1",
    updatedAt: "2026-08-12T00:00:00Z",
    tasks: [{
      taskId: "TASK-N2-020",
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
    }],
  };
}

function queue(taskDefinitionVersion: number): QueueState {
  return {
    stateSchemaVersion: "research-queue-state-v1",
    stateVersion: 1,
    catalogVersion: "v1",
    updatedAt: "2026-08-12T00:00:00Z",
    tasks: {
      "TASK-N2-020": {
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
      },
    },
  };
}

test("N2 activation rejects stale queue definition version", () => {
  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(catalog(), queue(1)),
    ["TASK-N2-020:TASK_DEFINITION_VERSION_MISMATCH"],
  );
});

test("N2 activation accepts matching definition version", () => {
  assert.deepEqual(findN2DormantTaskDefinitionDrift(catalog(), queue(2)), []);
});

test("N2 activation rejects future queue definition version too", () => {
  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(catalog(), queue(3)),
    ["TASK-N2-020:TASK_DEFINITION_VERSION_MISMATCH"],
  );
});

test("N2 activation rejects queue state from a different catalog version", () => {
  const mismatchedState = queue(2);
  mismatchedState.catalogVersion = "v0";
  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(catalog(), mismatchedState),
    ["CATALOG_VERSION_MISMATCH"],
  );
});
