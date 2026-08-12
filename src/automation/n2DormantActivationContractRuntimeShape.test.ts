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

for (const malformed of [undefined, "false"] as const) {
  test(`direct planner rejects malformed runtime registration ${String(malformed)}`, () => {
    const runtime = Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, false])) as Record<string, unknown>;
    if (malformed === undefined) delete runtime["TASK-N2-020"];
    else runtime["TASK-N2-020"] = malformed;

    const plan = buildN2DormantActivationPlan({
      readinessStatus: "READY_FOR_N2_020",
      taskStatuses: blockedTaskStatuses(),
      catalogDefaultStatuses: blockedCatalog(),
      runtimeExecutorRegistered: runtime as Record<string, boolean | undefined>,
    });

    assert.equal(plan.status, "CONFLICT");
    assert.equal(plan.stage, "CONFLICT");
    assert.ok(plan.blockers.includes("TASK-N2-020:RUNTIME_REGISTRATION_STATE_INVALID"));
    assert.deepEqual(plan.activationActions, []);
    assert.equal(plan.invariants.activationPlanningConsumesAttempt, false);
    assert.equal(plan.currentBuyConnectionAuthorized, false);
    assert.equal(plan.lineConnectionAuthorized, false);
    assert.equal(plan.publicPublishAuthorized, false);
    assert.equal(plan.automatedBettingAuthorized, false);
    assert.equal(plan.productionApplyAuthorized, false);
  });
}
