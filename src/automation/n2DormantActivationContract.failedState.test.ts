import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_DORMANT_TASKS,
  buildN2DormantActivationPlan,
} from "./n2DormantActivationContract";

function blockedCatalog(): Record<string, string> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, "BLOCKED_EXECUTOR_PENDING"]));
}

function unregistered(): Record<string, boolean> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, false]));
}

function blockedStatuses(): Record<string, string> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, "BLOCKED_EXECUTOR_PENDING"]));
}

test("failed dormant baseline state never produces an activation action", () => {
  const statuses = blockedStatuses();
  statuses["TASK-N2-020"] = "FAILED_FINAL";

  const plan = buildN2DormantActivationPlan({
    readinessStatus: "READY_FOR_N2_020",
    taskStatuses: statuses,
    catalogDefaultStatuses: blockedCatalog(),
    runtimeExecutorRegistered: unregistered(),
  });

  assert.equal(plan.status, "PASS");
  assert.equal(plan.stage, "WAITING_BASELINES_PASS");
  assert.deepEqual(plan.activationActions, []);
  assert.equal(plan.automaticPromotionAuthorized, false);
  assert.equal(plan.currentBuyConnectionAuthorized, false);
  assert.equal(plan.lineConnectionAuthorized, false);
  assert.equal(plan.publicPublishAuthorized, false);
  assert.equal(plan.databaseWriteAuthorized, false);
  assert.equal(plan.automatedBettingAuthorized, false);
  assert.equal(plan.productionApplyAuthorized, false);
});
