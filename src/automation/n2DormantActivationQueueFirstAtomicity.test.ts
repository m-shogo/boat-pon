import assert from "node:assert/strict";
import test from "node:test";

import { buildN2MarketBaselineReadinessReport } from "../research-replay/n2MarketBaselineReadiness";
import {
  N2_DORMANT_TASKS,
  buildN2DormantActivationPlan,
} from "./n2DormantActivationContract";
import { buildN2DormantActivationReport } from "./n2DormantActivationReport";

const taskTypes: Record<(typeof N2_DORMANT_TASKS)[number], string> = {
  "TASK-N2-020": "baseline-market",
  "TASK-N2-021": "baseline-historical",
  "TASK-N2-022": "baseline-common-cohort",
  "TASK-N2-030": "evaluation-metrics",
  "TASK-N2-040": "edge-hypothesis-scan",
  "TASK-N2-041": "edge-historical-test",
  "TASK-N2-042": "confounder-audit",
};

function readiness() {
  const races = Array.from({ length: 20 }, (_, index) =>
    `2026-08-${String(index + 1).padStart(2, "0")}:01:R1`
  );
  return buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: races,
    settledRaceKeys: races,
  });
}

function catalog() {
  return N2_DORMANT_TASKS.map((taskId) => ({
    taskId,
    taskType: taskTypes[taskId],
    defaultStatus: "BLOCKED_EXECUTOR_PENDING",
  }));
}

function queue() {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, {
    status: "BLOCKED_EXECUTOR_PENDING",
    attemptCount: 0,
    maxAttempts: 3,
  }]));
}

function registered() {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, false]));
}

for (const status of ["READY", "CLAIMED", "RUNNING", "CHECKPOINTED"] as const) {
  test(`activation report rejects queue-first partial activation in ${status}`, () => {
    const queueTasks = queue();
    queueTasks["TASK-N2-020"].status = status;

    const report = buildN2DormantActivationReport({
      readiness: readiness(),
      catalogTasks: catalog(),
      queueTasks,
      runtimeRegisteredByTaskId: registered(),
    });

    assert.equal(report.status, "CONFLICT");
    assert.equal(report.stage, "CONFLICT");
    assert.ok(report.blockers.includes(
      "TASK-N2-020:QUEUE_ACTIVATED_WHILE_CATALOG_AND_EXECUTOR_DORMANT",
    ));
    assert.deepEqual(report.activationActions, []);
    assert.equal(report.activationPlanningAttemptDelta, 0);
    assert.equal(report.currentBuyConnectionAuthorized, false);
    assert.equal(report.lineConnectionAuthorized, false);
    assert.equal(report.publicPublishAuthorized, false);
    assert.equal(report.automatedBettingAuthorized, false);
    assert.equal(report.productionApplyAuthorized, false);
  });

  test(`direct activation planner rejects queue-first partial activation in ${status}`, () => {
    const taskStatuses = Object.fromEntries(
      N2_DORMANT_TASKS.map((taskId) => [taskId, "BLOCKED_EXECUTOR_PENDING"]),
    );
    taskStatuses["TASK-N2-020"] = status;
    const catalogDefaultStatuses = Object.fromEntries(
      N2_DORMANT_TASKS.map((taskId) => [taskId, "BLOCKED_EXECUTOR_PENDING"]),
    );

    const plan = buildN2DormantActivationPlan({
      readinessStatus: "READY_FOR_N2_020",
      taskStatuses,
      catalogDefaultStatuses,
      runtimeExecutorRegistered: registered(),
    });

    assert.equal(plan.status, "CONFLICT");
    assert.equal(plan.stage, "CONFLICT");
    assert.ok(plan.blockers.includes(
      "TASK-N2-020:QUEUE_ACTIVATED_WHILE_CATALOG_AND_EXECUTOR_DORMANT",
    ));
    assert.deepEqual(plan.activationActions, []);
    assert.equal(plan.invariants.activationPlanningConsumesAttempt, false);
    assert.equal(plan.currentBuyConnectionAuthorized, false);
    assert.equal(plan.lineConnectionAuthorized, false);
    assert.equal(plan.publicPublishAuthorized, false);
    assert.equal(plan.automatedBettingAuthorized, false);
    assert.equal(plan.productionApplyAuthorized, false);
  });
}
