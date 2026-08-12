import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_DORMANT_TASKS,
  buildN2DormantActivationPlan,
} from "./n2DormantActivationContract";

function blockedTaskStatuses(): Record<string, string> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, "BLOCKED_EXECUTOR_PENDING"]));
}

function blockedCatalog(): Record<string, string> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, "BLOCKED_EXECUTOR_PENDING"]));
}

function unregistered(): Record<string, boolean> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, false]));
}

test("baseline pair activation cannot diverge before either baseline runs", () => {
  const taskStatuses = blockedTaskStatuses();
  const catalogDefaultStatuses = blockedCatalog();
  const runtimeExecutorRegistered = unregistered();

  taskStatuses["TASK-N2-020"] = "READY";
  catalogDefaultStatuses["TASK-N2-020"] = "READY";
  runtimeExecutorRegistered["TASK-N2-020"] = true;

  const plan = buildN2DormantActivationPlan({
    readinessStatus: "READY_FOR_N2_020",
    taskStatuses,
    catalogDefaultStatuses,
    runtimeExecutorRegistered,
  });

  assert.equal(plan.status, "CONFLICT");
  assert.equal(plan.stage, "CONFLICT");
  assert.ok(plan.blockers.includes("BASELINE_PAIR_ACTIVATION_STATE_DIVERGED"));
  assert.deepEqual(plan.activationActions, []);
  assert.equal(plan.invariants.baselinePairActivatesTogether, true);
  assert.equal(plan.invariants.activationPlanningConsumesAttempt, false);
  assert.equal(plan.currentBuyConnectionAuthorized, false);
  assert.equal(plan.lineConnectionAuthorized, false);
  assert.equal(plan.publicPublishAuthorized, false);
  assert.equal(plan.automatedBettingAuthorized, false);
  assert.equal(plan.productionApplyAuthorized, false);
});
