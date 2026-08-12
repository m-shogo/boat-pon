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

function unregistered() {
  return Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => [taskId, false]));
}

test("digest-valid non-array readiness blockers fail closed", () => {
  const accepted = Array.from({ length: 5 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}:01:R1`);
  const valid = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: accepted,
    settledRaceKeys: accepted,
  });
  const forgedWithStaleDigest = {
    ...valid,
    blockers: "" as unknown as string[],
  };
  const { outputDigest: _staleDigest, ...forgedCore } = forgedWithStaleDigest;
  const forged = {
    ...forgedWithStaleDigest,
    outputDigest: canonicalHash(forgedCore),
  };

  const report = buildN2DormantActivationReport({
    readiness: forged,
    catalogTasks: catalog(),
    queueTasks: queue(),
    runtimeRegisteredByTaskId: unregistered(),
  });

  assert.equal(report.status, "CONFLICT");
  assert.equal(report.stage, "CONFLICT");
  assert.ok(report.blockers.includes("READINESS_BLOCKERS_INVALID"));
  assert.deepEqual(report.activationActions, []);
  assert.equal(report.activationPlanningAttemptDelta, 0);
  assert.equal(report.currentBuyConnectionAuthorized, false);
  assert.equal(report.lineConnectionAuthorized, false);
  assert.equal(report.publicPublishAuthorized, false);
  assert.equal(report.automatedBettingAuthorized, false);
  assert.equal(report.productionApplyAuthorized, false);
});
