import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
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
function registered() {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, false]));
}
function readiness(settled: number) {
  const accepted = Array.from({ length: Math.max(settled, 1) }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}:01:R1`);
  return buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: settled === 0 ? [] : accepted,
    settledRaceKeys: accepted.slice(0, settled),
  });
}

test("accumulating private cohort reports WAITING without consuming attempts", () => {
  const report = buildN2DormantActivationReport({
    readiness: readiness(5),
    catalogTasks: catalog(),
    queueTasks: queue(),
    runtimeRegisteredByTaskId: registered(),
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.stage, "WAITING_PRIVATE_COHORT");
  assert.deepEqual(report.activationActions, []);
  assert.equal(report.readiness.settledAcceptedT5RaceCount, 5);
  assert.equal(report.readiness.minimumSettledRaceCount, 20);
  assert.equal(report.activationPlanningAttemptDelta, 0);
  for (const taskId of N2_DORMANT_TASKS) assert.equal(report.tasks[taskId].attemptCount, 0);
  assert.equal(report.automaticMutationAuthorized, false);
  assert.equal(report.rawOddsValuesReadByPlanner, false);
  assert.equal(report.databaseWriteCount, 0);
  assert.equal(report.networkRequestCount, 0);
});

test("20 clean settled races exposes exactly the atomic baseline activation action", () => {
  const report = buildN2DormantActivationReport({
    readiness: readiness(20),
    catalogTasks: catalog(),
    queueTasks: queue(),
    runtimeRegisteredByTaskId: registered(),
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.stage, "ACTIVATE_BASELINES");
  assert.equal(report.readiness.n2TaskReady, true);
  assert.equal(report.activationActions.length, 1);
  assert.deepEqual(report.activationActions[0].taskIds, ["TASK-N2-020", "TASK-N2-021"]);
  assert.deepEqual(report.activationActions[0].requiredAtomicChanges, [
    "register_executor",
    "change_catalog_default_status",
    "update_automation_state",
  ]);
  assert.equal(report.activationActions[0].automaticMutationAuthorized, false);
});

test("report follows later PASS state while preserving zero planner attempt delta", () => {
  const passedTaskIds = ["TASK-N2-020", "TASK-N2-021", "TASK-N2-022", "TASK-N2-030"] as const;
  const q = queue();
  const c = catalog();
  const reg = registered();
  for (const taskId of passedTaskIds) {
    q[taskId] = { ...q[taskId], status: "PASS", attemptCount: 1 };
    const catalogTask = c.find((item) => item.taskId === taskId);
    assert.ok(catalogTask);
    catalogTask.defaultStatus = "READY";
    reg[taskId] = true;
  }
  const report = buildN2DormantActivationReport({
    readiness: readiness(20),
    catalogTasks: c,
    queueTasks: q,
    runtimeRegisteredByTaskId: reg,
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.stage, "ACTIVATE_EDGE_SCAN");
  assert.deepEqual(report.activationActions[0].taskIds, ["TASK-N2-040"]);
  assert.equal(report.activationPlanningAttemptDelta, 0);
});

test("missing state and partial activation are fail-closed conflicts", () => {
  const q = queue();
  delete q["TASK-N2-042"];
  const missing = buildN2DormantActivationReport({
    readiness: readiness(20),
    catalogTasks: catalog(),
    queueTasks: q,
    runtimeRegisteredByTaskId: registered(),
  });
  assert.equal(missing.status, "CONFLICT");
  assert.equal(missing.stage, "CONFLICT");
  assert.ok(missing.blockers.includes("TASK-N2-042:QUEUE_TASK_MISSING"));
  assert.deepEqual(missing.activationActions, []);

  const reg = registered();
  reg["TASK-N2-040"] = true;
  const partial = buildN2DormantActivationReport({
    readiness: readiness(20),
    catalogTasks: catalog(),
    queueTasks: queue(),
    runtimeRegisteredByTaskId: reg,
  });
  assert.equal(partial.status, "CONFLICT");
  assert.ok(partial.blockers.includes("TASK-N2-040:REGISTERED_WHILE_BLOCKED_EXECUTOR_PENDING"));
  assert.deepEqual(partial.activationActions, []);
});

test("attempt counts cannot exceed max attempts", () => {
  const q = queue();
  q["TASK-N2-020"] = { ...q["TASK-N2-020"], attemptCount: 4, maxAttempts: 3 };
  const report = buildN2DormantActivationReport({
    readiness: readiness(20),
    catalogTasks: catalog(),
    queueTasks: q,
    runtimeRegisteredByTaskId: registered(),
  });
  assert.equal(report.status, "CONFLICT");
  assert.ok(report.blockers.includes("TASK-N2-020:MAX_ATTEMPTS_INVALID"));
});

test("digest-valid unknown readiness status is a fail-closed conflict", () => {
  const valid = readiness(5);
  const forgedWithStaleDigest = { ...valid, status: "NOT_A_READINESS_STATUS" };
  const { outputDigest: _staleDigest, ...forgedCore } = forgedWithStaleDigest;
  const forged = {
    ...forgedWithStaleDigest,
    outputDigest: canonicalHash(forgedCore),
  } as unknown as typeof valid;
  const report = buildN2DormantActivationReport({
    readiness: forged,
    catalogTasks: catalog(),
    queueTasks: queue(),
    runtimeRegisteredByTaskId: registered(),
  });
  assert.equal(report.status, "CONFLICT");
  assert.equal(report.stage, "CONFLICT");
  assert.ok(report.blockers.includes("READINESS_STATUS_INVALID"));
  assert.deepEqual(report.activationActions, []);
  assert.equal(report.activationPlanningAttemptDelta, 0);
  assert.equal(report.currentBuyConnectionAuthorized, false);
  assert.equal(report.lineConnectionAuthorized, false);
  assert.equal(report.publicPublishAuthorized, false);
  assert.equal(report.automatedBettingAuthorized, false);
  assert.equal(report.productionApplyAuthorized, false);
});

test("digest-valid readiness status cannot contradict canonical counts", () => {
  const valid = readiness(20);
  const forgedWithStaleDigest = { ...valid, status: "ACCUMULATING", n2TaskReady: false } as const;
  const { outputDigest: _staleDigest, ...forgedCore } = forgedWithStaleDigest;
  const forged = {
    ...forgedWithStaleDigest,
    outputDigest: canonicalHash(forgedCore),
  } as unknown as typeof valid;
  const report = buildN2DormantActivationReport({
    readiness: forged,
    catalogTasks: catalog(),
    queueTasks: queue(),
    runtimeRegisteredByTaskId: registered(),
  });
  assert.equal(report.status, "CONFLICT");
  assert.equal(report.stage, "CONFLICT");
  assert.ok(report.blockers.includes("READINESS_STATUS_COUNTS_INCONSISTENT"));
  assert.deepEqual(report.activationActions, []);
  assert.equal(report.activationPlanningAttemptDelta, 0);
  assert.equal(report.currentBuyConnectionAuthorized, false);
  assert.equal(report.lineConnectionAuthorized, false);
  assert.equal(report.publicPublishAuthorized, false);
  assert.equal(report.automatedBettingAuthorized, false);
  assert.equal(report.productionApplyAuthorized, false);
});
