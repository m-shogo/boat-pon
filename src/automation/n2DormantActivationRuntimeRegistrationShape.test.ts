import assert from "node:assert/strict";
import test from "node:test";

import { buildN2MarketBaselineReadinessReport } from "../research-replay/n2MarketBaselineReadiness";
import { N2_DORMANT_TASKS } from "./n2DormantActivationContract";
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

test("non-boolean runtime registration evidence cannot authorize baseline activation", () => {
  const accepted = Array.from({ length: 20 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}:01:R1`);
  const readiness = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: accepted,
    settledRaceKeys: accepted,
  });
  assert.equal(readiness.status, "READY_FOR_N2_020");

  const malformedRuntime = Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, false])) as Record<string, unknown>;
  malformedRuntime["TASK-N2-020"] = "false";

  const report = buildN2DormantActivationReport({
    readiness,
    catalogTasks: catalog(),
    queueTasks: queue(),
    runtimeRegisteredByTaskId: malformedRuntime as Record<string, boolean | undefined>,
  });

  assert.equal(report.status, "CONFLICT");
  assert.equal(report.stage, "CONFLICT");
  assert.ok(report.blockers.includes("TASK-N2-020:RUNTIME_REGISTRATION_STATE_INVALID"));
  assert.deepEqual(report.activationActions, []);
  assert.equal(report.activationPlanningAttemptDelta, 0);
  assert.equal(report.currentBuyConnectionAuthorized, false);
  assert.equal(report.lineConnectionAuthorized, false);
  assert.equal(report.publicPublishAuthorized, false);
  assert.equal(report.automatedBettingAuthorized, false);
  assert.equal(report.productionApplyAuthorized, false);
});
