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

function blockedTaskStatuses(): Record<string, string> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, "BLOCKED_EXECUTOR_PENDING"]));
}

test("activation planner waits for the private 20-race cohort without mutations", () => {
  const plan = buildN2DormantActivationPlan({
    readinessStatus: "ACCUMULATING",
    taskStatuses: blockedTaskStatuses(),
    catalogDefaultStatuses: blockedCatalog(),
    runtimeExecutorRegistered: unregistered(),
  });
  assert.equal(plan.status, "PASS");
  assert.equal(plan.stage, "WAITING_PRIVATE_COHORT");
  assert.deepEqual(plan.activationActions, []);
  assert.equal(plan.invariants.activationPlanningConsumesAttempt, false);
});

test("READY_FOR_N2_020 yields one atomic baseline-pair activation action", () => {
  const plan = buildN2DormantActivationPlan({
    readinessStatus: "READY_FOR_N2_020",
    taskStatuses: blockedTaskStatuses(),
    catalogDefaultStatuses: blockedCatalog(),
    runtimeExecutorRegistered: unregistered(),
  });
  assert.equal(plan.status, "PASS");
  assert.equal(plan.stage, "ACTIVATE_BASELINES");
  assert.equal(plan.activationActions.length, 1);
  assert.deepEqual(plan.activationActions[0].taskIds, ["TASK-N2-020", "TASK-N2-021"]);
  assert.deepEqual(plan.activationActions[0].requiredAtomicChanges, [
    "register_executor",
    "change_catalog_default_status",
    "update_automation_state",
  ]);
  assert.equal(plan.activationActions[0].automaticMutationAuthorized, false);
});

test("both baseline PASS states unlock only the common-cohort activation", () => {
  const statuses = blockedTaskStatuses();
  statuses["TASK-N2-020"] = "PASS";
  statuses["TASK-N2-021"] = "PASS";
  const plan = buildN2DormantActivationPlan({
    readinessStatus: "READY_FOR_N2_020",
    taskStatuses: statuses,
    catalogDefaultStatuses: blockedCatalog(),
    runtimeExecutorRegistered: unregistered(),
  });
  assert.equal(plan.status, "PASS");
  assert.equal(plan.stage, "ACTIVATE_COMMON_COHORT");
  assert.deepEqual(plan.activationActions[0].taskIds, ["TASK-N2-022"]);
});

test("common-cohort PASS unlocks only metrics activation", () => {
  const statuses = blockedTaskStatuses();
  statuses["TASK-N2-020"] = "PASS";
  statuses["TASK-N2-021"] = "PASS";
  statuses["TASK-N2-022"] = "PASS";
  const plan = buildN2DormantActivationPlan({
    readinessStatus: "READY_FOR_N2_020",
    taskStatuses: statuses,
    catalogDefaultStatuses: blockedCatalog(),
    runtimeExecutorRegistered: unregistered(),
  });
  assert.equal(plan.status, "PASS");
  assert.equal(plan.stage, "ACTIVATE_METRICS");
  assert.deepEqual(plan.activationActions[0].taskIds, ["TASK-N2-030"]);
});

test("metrics PASS marks the dormant activation chain complete", () => {
  const statuses = Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, "PASS"]));
  const plan = buildN2DormantActivationPlan({
    readinessStatus: "READY_FOR_N2_020",
    taskStatuses: statuses,
    catalogDefaultStatuses: blockedCatalog(),
    runtimeExecutorRegistered: unregistered(),
  });
  assert.equal(plan.status, "PASS");
  assert.equal(plan.stage, "COMPLETE");
  assert.deepEqual(plan.activationActions, []);
});

test("baseline PASS divergence is a fail-closed conflict", () => {
  const statuses = blockedTaskStatuses();
  statuses["TASK-N2-020"] = "PASS";
  const plan = buildN2DormantActivationPlan({
    readinessStatus: "READY_FOR_N2_020",
    taskStatuses: statuses,
    catalogDefaultStatuses: blockedCatalog(),
    runtimeExecutorRegistered: unregistered(),
  });
  assert.equal(plan.status, "CONFLICT");
  assert.equal(plan.stage, "CONFLICT");
  assert.ok(plan.blockers.includes("BASELINE_PAIR_PASS_STATE_DIVERGED"));
  assert.deepEqual(plan.activationActions, []);
});

test("registered executor while catalog remains blocked is a conflict", () => {
  const registered = unregistered();
  registered["TASK-N2-020"] = true;
  const plan = buildN2DormantActivationPlan({
    readinessStatus: "READY_FOR_N2_020",
    taskStatuses: blockedTaskStatuses(),
    catalogDefaultStatuses: blockedCatalog(),
    runtimeExecutorRegistered: registered,
  });
  assert.equal(plan.status, "CONFLICT");
  assert.ok(plan.blockers.includes("TASK-N2-020:REGISTERED_WHILE_BLOCKED_EXECUTOR_PENDING"));
});

test("activation plan never grants product or betting authority and is deterministic", () => {
  const input = {
    readinessStatus: "ACCUMULATING",
    taskStatuses: blockedTaskStatuses(),
    catalogDefaultStatuses: blockedCatalog(),
    runtimeExecutorRegistered: unregistered(),
  };
  const first = buildN2DormantActivationPlan(input);
  const second = buildN2DormantActivationPlan(input);
  assert.equal(first.automaticPromotionAuthorized, false);
  assert.equal(first.currentBuyConnectionAuthorized, false);
  assert.equal(first.lineConnectionAuthorized, false);
  assert.equal(first.publicPublishAuthorized, false);
  assert.equal(first.databaseWriteAuthorized, false);
  assert.equal(first.automatedBettingAuthorized, false);
  assert.equal(first.productionApplyAuthorized, false);
  assert.equal(first.outputDigest, second.outputDigest);
  assert.match(first.outputDigest, /^[0-9a-f]{64}$/u);
});
