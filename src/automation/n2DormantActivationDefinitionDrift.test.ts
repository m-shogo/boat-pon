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

const expectedOutputs: Record<(typeof N2_DORMANT_TASKS)[number], string[]> = {
  "TASK-N2-020": ["reports/n2/n2-baseline-market.json"],
  "TASK-N2-021": ["reports/n2/n2-baseline-historical.json"],
  "TASK-N2-022": ["reports/n2/n2-baseline-common-cohort.json"],
  "TASK-N2-030": ["reports/n2/n2-evaluation-metrics.json"],
  "TASK-N2-040": ["reports/n2/n2-edge-hypothesis-scan.json"],
  "TASK-N2-041": ["reports/n2/n2-edge-historical-test.json"],
  "TASK-N2-042": ["reports/n2/n2-confounder-audit.json"],
};

function catalog(): TaskCatalog {
  return {
    catalogSchemaVersion: "research-task-catalog-v1",
    catalogVersion: "v1",
    updatedAt: "2026-08-12T00:00:00Z",
    tasks: N2_DORMANT_TASKS.map((taskId) => ({
      taskId,
      taskDefinitionVersion: 1,
      title: "market baseline",
      objective: "o",
      taskType: taskTypes[taskId],
      executor: taskTypes[taskId],
      safetyLevel: "L0",
      dependencies: [...dependencies[taskId]],
      maxDurationSeconds: 3600,
      expectedInputs: [],
      expectedOutputs: [...expectedOutputs[taskId]],
      estimatedDurationSeconds: 60,
      defaultStatus: "BLOCKED_EXECUTOR_PENDING",
      valueOfInformation: "v",
      invalidationCondition: "i",
    })),
  };
}

function queue(taskDefinitionVersion = 1): QueueState {
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

test("N2 activation rejects queue definition version drift", () => {
  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(catalog(), queue(2)),
    N2_DORMANT_TASKS.map((taskId) => `${taskId}:TASK_DEFINITION_VERSION_MISMATCH`),
  );
});

test("N2 activation accepts canonical definition versions", () => {
  assert.deepEqual(findN2DormantTaskDefinitionDrift(catalog(), queue()), []);
});

test("N2 activation rejects catalog and queue moving together beyond the pinned contract", () => {
  const futureCatalog = catalog();
  for (const task of futureCatalog.tasks) task.taskDefinitionVersion = 2;
  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(futureCatalog, queue(2)),
    N2_DORMANT_TASKS.map((taskId) => `${taskId}:CATALOG_TASK_DEFINITION_VERSION_MISMATCH`),
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

test("N2 activation fails closed before readiness when catalog safety level drifts", () => {
  const mismatchedCatalog = catalog();
  const task = mismatchedCatalog.tasks.find((entry) => entry.taskId === "TASK-N2-020");
  assert.ok(task);
  task.safetyLevel = "L1";

  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(mismatchedCatalog, queue()),
    ["TASK-N2-020:CATALOG_SAFETY_LEVEL_MISMATCH"],
  );
});

test("N2 activation fails closed before readiness when catalog max duration drifts", () => {
  const mismatchedCatalog = catalog();
  const task = mismatchedCatalog.tasks.find((entry) => entry.taskId === "TASK-N2-020");
  assert.ok(task);
  task.maxDurationSeconds = 7200;

  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(mismatchedCatalog, queue()),
    ["TASK-N2-020:CATALOG_MAX_DURATION_MISMATCH"],
  );
});

test("N2 activation fails closed before readiness when catalog expected outputs drift", () => {
  const mismatchedCatalog = catalog();
  const task = mismatchedCatalog.tasks.find((entry) => entry.taskId === "TASK-N2-020");
  assert.ok(task);
  task.expectedOutputs = ["public/n2-baseline-market.json"];

  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(mismatchedCatalog, queue()),
    ["TASK-N2-020:CATALOG_EXPECTED_OUTPUTS_MISMATCH"],
  );
});

test("N2 activation fails closed before readiness when catalog activates while queue remains dormant", () => {
  const mismatchedCatalog = catalog();
  const task = mismatchedCatalog.tasks.find((entry) => entry.taskId === "TASK-N2-020");
  assert.ok(task);
  task.defaultStatus = "READY";

  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(mismatchedCatalog, queue(), { "TASK-N2-020": true }),
    ["TASK-N2-020:CATALOG_STATUS_MISMATCH_WHILE_QUEUE_DORMANT"],
  );
});

test("N2 activation fails closed before readiness when catalog and queue activate without runtime executor", () => {
  const activeCatalog = catalog();
  const activeState = queue();
  const task = activeCatalog.tasks.find((entry) => entry.taskId === "TASK-N2-020");
  assert.ok(task);
  task.defaultStatus = "READY";
  activeState.tasks["TASK-N2-020"].status = "READY";

  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(activeCatalog, activeState, { "TASK-N2-020": false }),
    ["TASK-N2-020:RUNTIME_EXECUTOR_MISSING_WHILE_CATALOG_AND_QUEUE_ACTIVE"],
  );
});

test("N2 activation preflight preserves a valid atomic active state", () => {
  const activeCatalog = catalog();
  const activeState = queue();
  const task = activeCatalog.tasks.find((entry) => entry.taskId === "TASK-N2-020");
  assert.ok(task);
  task.defaultStatus = "READY";
  activeState.tasks["TASK-N2-020"].status = "READY";

  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(activeCatalog, activeState, { "TASK-N2-020": true }),
    [],
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

test("N2 activation fails closed before readiness when dormant execution residue is present", () => {
  const cases: Array<{
    mutate: (state: QueueState) => void;
    blocker: string;
  }> = [
    {
      mutate: (state) => { state.tasks["TASK-N2-020"].authoritySha = "deadbeef"; },
      blocker: "TASK-N2-020:DORMANT_AUTHORITY_SHA_PRESENT",
    },
    {
      mutate: (state) => { state.tasks["TASK-N2-020"].evidenceLinks = ["reports/automation/history/1-TASK-N2-020.json"]; },
      blocker: "TASK-N2-020:DORMANT_EVIDENCE_PRESENT",
    },
    {
      mutate: (state) => { state.tasks["TASK-N2-020"].resultDigest = "a".repeat(64); },
      blocker: "TASK-N2-020:DORMANT_RESULT_DIGEST_PRESENT",
    },
  ];

  for (const scenario of cases) {
    const state = queue();
    scenario.mutate(state);
    assert.deepEqual(findN2DormantTaskDefinitionDrift(catalog(), state), [scenario.blocker]);
  }
});
