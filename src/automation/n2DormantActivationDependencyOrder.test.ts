import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_DORMANT_TASKS,
  type N2DormantTaskId,
  buildN2DormantActivationPlan,
} from "./n2DormantActivationContract";

function dormantStatuses(): Record<string, string> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, "BLOCKED_EXECUTOR_PENDING"]));
}

function dormantCatalog(): Record<string, string> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, "BLOCKED_EXECUTOR_PENDING"]));
}

function unregisteredExecutors(): Record<string, boolean> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, false]));
}

const cases: Array<{
  taskId: N2DormantTaskId;
  blocker: string;
}> = [
  {
    taskId: "TASK-N2-022",
    blocker: "COMMON_COHORT_ACTIVATED_WITHOUT_BOTH_BASELINES_PASS",
  },
  {
    taskId: "TASK-N2-030",
    blocker: "METRICS_ACTIVATED_WITHOUT_COMMON_COHORT_PASS",
  },
  {
    taskId: "TASK-N2-040",
    blocker: "EDGE_SCAN_ACTIVATED_WITHOUT_METRICS_PASS",
  },
  {
    taskId: "TASK-N2-041",
    blocker: "HISTORICAL_TEST_ACTIVATED_WITHOUT_EDGE_SCAN_PASS",
  },
  {
    taskId: "TASK-N2-042",
    blocker: "CONFOUNDER_AUDIT_ACTIVATED_WITHOUT_HISTORICAL_TEST_PASS",
  },
];

for (const { taskId, blocker } of cases) {
  test(`${taskId} cannot activate before its dependency chain passes`, () => {
    const taskStatuses = dormantStatuses();
    const catalogDefaultStatuses = dormantCatalog();
    const runtimeExecutorRegistered = unregisteredExecutors();

    taskStatuses[taskId] = "READY";
    catalogDefaultStatuses[taskId] = "READY";
    runtimeExecutorRegistered[taskId] = true;

    const plan = buildN2DormantActivationPlan({
      readinessStatus: "READY_FOR_N2_020",
      taskStatuses,
      catalogDefaultStatuses,
      runtimeExecutorRegistered,
    });

    assert.equal(plan.status, "CONFLICT");
    assert.equal(plan.stage, "CONFLICT");
    assert.ok(plan.blockers.includes(blocker));
    assert.deepEqual(plan.activationActions, []);
    assert.equal(plan.invariants.activationPlanningConsumesAttempt, false);
    assert.equal(plan.currentBuyConnectionAuthorized, false);
    assert.equal(plan.lineConnectionAuthorized, false);
    assert.equal(plan.publicPublishAuthorized, false);
    assert.equal(plan.automatedBettingAuthorized, false);
    assert.equal(plan.productionApplyAuthorized, false);
  });
}
