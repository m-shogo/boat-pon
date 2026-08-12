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

const outputs: Record<(typeof N2_DORMANT_TASKS)[number], string[]> = {
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
      title: taskId,
      objective: "research-only dormant task",
      taskType: taskTypes[taskId],
      executor: taskTypes[taskId],
      safetyLevel: "L0",
      dependencies: [...dependencies[taskId]],
      maxDurationSeconds: 3600,
      expectedInputs: [],
      expectedOutputs: [...outputs[taskId]],
      estimatedDurationSeconds: 300,
      defaultStatus: "BLOCKED_EXECUTOR_PENDING",
      valueOfInformation: "medium",
      invalidationCondition: "definition change requires explicit contract update",
    })),
  };
}

function queue(): QueueState {
  return {
    stateSchemaVersion: "research-queue-state-v1",
    stateVersion: 1,
    catalogVersion: "v1",
    updatedAt: "2026-08-12T00:00:00Z",
    tasks: Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, {
      status: "BLOCKED_EXECUTOR_PENDING",
      taskDefinitionVersion: 1,
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

test("N2 activation fails closed before readiness when dormant expected inputs drift", () => {
  const mismatchedCatalog = catalog();
  const task = mismatchedCatalog.tasks.find((entry) => entry.taskId === "TASK-N2-020");
  assert.ok(task);
  task.expectedInputs = ["private/raw/t5-odds.json"];

  assert.deepEqual(
    findN2DormantTaskDefinitionDrift(mismatchedCatalog, queue()),
    ["TASK-N2-020:CATALOG_EXPECTED_INPUTS_MISMATCH"],
  );
});
