import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_DORMANT_TASKS,
  buildN2DormantActivationPlan,
} from "./n2DormantActivationContract";

function statuses(): Record<string, string> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, "BLOCKED_EXECUTOR_PENDING"]));
}
function catalog(): Record<string, string> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, "BLOCKED_EXECUTOR_PENDING"]));
}
function registrations(): Record<string, boolean> {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, false]));
}
function plan(taskStatuses: Record<string, string>, catalogStatuses = catalog(), registered = registrations()) {
  return buildN2DormantActivationPlan({
    readinessStatus: "READY_FOR_N2_020",
    taskStatuses,
    catalogDefaultStatuses: catalogStatuses,
    runtimeExecutorRegistered: registered,
  });
}

function passThrough(taskId: string): Record<string, string> {
  const value = statuses();
  for (const id of N2_DORMANT_TASKS) {
    value[id] = "PASS";
    if (id === taskId) break;
  }
  return value;
}

test("metrics PASS unlocks edge scan and nothing later", () => {
  const result = plan(passThrough("TASK-N2-030"));
  assert.equal(result.status, "PASS");
  assert.equal(result.stage, "ACTIVATE_EDGE_SCAN");
  assert.deepEqual(result.activationActions.map((item) => item.taskIds), [["TASK-N2-040"]]);
});

test("edge scan PASS unlocks historical test and nothing later", () => {
  const result = plan(passThrough("TASK-N2-040"));
  assert.equal(result.stage, "ACTIVATE_HISTORICAL_TEST");
  assert.deepEqual(result.activationActions[0].taskIds, ["TASK-N2-041"]);
});

test("historical test PASS unlocks confounder audit and nothing later", () => {
  const result = plan(passThrough("TASK-N2-041"));
  assert.equal(result.stage, "ACTIVATE_CONFOUNDER_AUDIT");
  assert.deepEqual(result.activationActions[0].taskIds, ["TASK-N2-042"]);
});

test("confounder audit PASS completes the full dormant N2 chain", () => {
  const result = plan(passThrough("TASK-N2-042"));
  assert.equal(result.status, "PASS");
  assert.equal(result.stage, "COMPLETE");
  assert.deepEqual(result.activationActions, []);
});

test("an already activated stage waits for its own PASS instead of advancing", () => {
  const taskStatuses = passThrough("TASK-N2-030");
  const catalogStatuses = catalog();
  const registered = registrations();
  catalogStatuses["TASK-N2-040"] = "READY";
  registered["TASK-N2-040"] = true;
  taskStatuses["TASK-N2-040"] = "RUNNING";
  const result = plan(taskStatuses, catalogStatuses, registered);
  assert.equal(result.status, "PASS");
  assert.equal(result.stage, "WAITING_EDGE_SCAN_PASS");
  assert.deepEqual(result.activationActions, []);
});

test("future-stage PASS without its dependency is a fail-closed conflict", () => {
  const cases = [
    ["TASK-N2-040", "EDGE_SCAN_PASS_WITHOUT_METRICS_PASS"],
    ["TASK-N2-041", "HISTORICAL_TEST_PASS_WITHOUT_EDGE_SCAN_PASS"],
    ["TASK-N2-042", "CONFOUNDER_AUDIT_PASS_WITHOUT_HISTORICAL_TEST_PASS"],
  ] as const;
  for (const [taskId, blocker] of cases) {
    const taskStatuses = statuses();
    taskStatuses[taskId] = "PASS";
    const result = plan(taskStatuses);
    assert.equal(result.status, "CONFLICT", taskId);
    assert.equal(result.stage, "CONFLICT", taskId);
    assert.ok(result.blockers.includes(blocker), `${taskId}: ${result.blockers.join(",")}`);
  }
});

test("every edge-stage activation still requires one atomic reviewed change", () => {
  for (const target of ["TASK-N2-040", "TASK-N2-041", "TASK-N2-042"] as const) {
    const prerequisite = target === "TASK-N2-040" ? "TASK-N2-030"
      : target === "TASK-N2-041" ? "TASK-N2-040" : "TASK-N2-041";
    const result = plan(passThrough(prerequisite));
    assert.equal(result.activationActions.length, 1);
    assert.deepEqual(result.activationActions[0].taskIds, [target]);
    assert.deepEqual(result.activationActions[0].requiredAtomicChanges, [
      "register_executor",
      "change_catalog_default_status",
      "update_automation_state",
    ]);
    assert.equal(result.activationActions[0].automaticMutationAuthorized, false);
  }
});
