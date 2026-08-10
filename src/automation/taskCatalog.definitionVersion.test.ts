import assert from "node:assert/strict";
import test from "node:test";
import { dispatchableTasks, mergeCatalogAndState, reconcileCatalogState, type QueueState, type TaskCatalog } from "./taskCatalog";

const catalog: TaskCatalog = {
  catalogSchemaVersion: "research-task-catalog-v1",
  catalogVersion: "v1",
  updatedAt: "2026-08-10T00:00:00Z",
  tasks: [{
    taskId: "TASK-N2-001", taskDefinitionVersion: 2, title: "t", objective: "o",
    taskType: "dataset-canary", executor: "dataset-canary", safetyLevel: "L2",
    dependencies: [], maxDurationSeconds: 3600, expectedInputs: [], expectedOutputs: [],
    estimatedDurationSeconds: 60, defaultStatus: "READY", valueOfInformation: "v", invalidationCondition: "i",
  }],
};

function state(taskDefinitionVersion: number): QueueState {
  return {
    stateSchemaVersion: "research-queue-state-v1", stateVersion: 1, catalogVersion: "v1", updatedAt: "2026-08-10T00:00:00Z",
    tasks: {
      "TASK-N2-001": {
        status: "READY", taskDefinitionVersion, authoritySha: null, attemptCount: 0, maxAttempts: 3,
        evidenceLinks: [], resultDigest: null, lastFailure: null, checkpoint: null, updatedAt: "2026-08-10T00:00:00Z",
      },
    },
  };
}

test("definition version mismatch is stale in either direction", () => {
  assert.equal(mergeCatalogAndState(catalog, state(1))[0].staleDefinition, true);
  assert.equal(mergeCatalogAndState(catalog, state(2))[0].staleDefinition, false);
  assert.equal(mergeCatalogAndState(catalog, state(3))[0].staleDefinition, true);
});

test("future queue definition version cannot become dispatchable", () => {
  assert.deepEqual(dispatchableTasks(mergeCatalogAndState(catalog, state(3))), []);
});

test("reconcile reports definition version mismatch in either direction", () => {
  assert.deepEqual(reconcileCatalogState(catalog, state(2)).plan.staleDefinition, []);
  assert.equal(reconcileCatalogState(catalog, state(1)).plan.staleDefinition[0]?.taskId, "TASK-N2-001");
  assert.equal(reconcileCatalogState(catalog, state(3)).plan.staleDefinition[0]?.taskId, "TASK-N2-001");
});

test("any definition drift blocks unrelated catalog reconciliation", () => {
  const drifted = state(1);
  const expandedCatalog: TaskCatalog = {
    ...catalog,
    catalogVersion: "v2",
    tasks: [
      ...catalog.tasks,
      {
        ...catalog.tasks[0],
        taskId: "TASK-N2-002",
        taskDefinitionVersion: 1,
      },
    ],
  };
  const result = reconcileCatalogState(expandedCatalog, drifted, { now: "2026-08-10T01:00:00Z" });
  assert.equal(result.changed, false);
  assert.equal(result.nextState, drifted);
  assert.equal(result.nextState.catalogVersion, "v1");
  assert.equal(result.nextState.stateVersion, 1);
  assert.equal("TASK-N2-002" in result.nextState.tasks, false);
  assert.equal(result.plan.staleDefinition[0]?.taskId, "TASK-N2-001");
  assert.equal(result.plan.added[0]?.taskId, "TASK-N2-002");
  assert.equal(result.plan.catalogVersionChanged, true);
});
