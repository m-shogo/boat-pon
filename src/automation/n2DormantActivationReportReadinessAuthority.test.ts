import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
import {
  buildN2MarketBaselineReadinessReport,
  type N2MarketBaselineReadinessReport,
} from "../research-replay/n2MarketBaselineReadiness";
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

function readyReadiness() {
  const races = Array.from({ length: 20 }, (_, index) =>
    `2026-08-${String(index + 1).padStart(2, "0")}:01:R1`
  );
  return buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: races,
    settledRaceKeys: races,
  });
}

function reportFor(readiness: N2MarketBaselineReadinessReport) {
  return buildN2DormantActivationReport({
    readiness,
    catalogTasks: catalog(),
    queueTasks: queue(),
    runtimeRegisteredByTaskId: registered(),
  });
}

test("activation report rejects digest-valid readiness that grants protected authority", () => {
  const readiness = readyReadiness();
  const { outputDigest: _oldDigest, ...core } = readiness;
  const forgedCore = {
    ...core,
    currentBuyConnectionAuthorized: true,
  };
  const forged = {
    ...forgedCore,
    outputDigest: canonicalHash(forgedCore),
  } as unknown as N2MarketBaselineReadinessReport;

  const report = reportFor(forged);

  assert.equal(report.status, "CONFLICT");
  assert.equal(report.stage, "CONFLICT");
  assert.ok(report.blockers.includes("READINESS_PROTECTED_AUTHORITY_INVALID"));
  assert.ok(!report.blockers.includes("READINESS_OUTPUT_DIGEST_INVALID"));
  assert.deepEqual(report.activationActions, []);
  assert.equal(report.activationPlanningAttemptDelta, 0);
  assert.equal(report.currentBuyConnectionAuthorized, false);
  assert.equal(report.lineConnectionAuthorized, false);
  assert.equal(report.publicPublishAuthorized, false);
  assert.equal(report.automatedBettingAuthorized, false);
  assert.equal(report.productionApplyAuthorized, false);
});

test("activation report rejects digest-valid readiness with the wrong identity", () => {
  const readiness = readyReadiness();
  const { outputDigest: _oldDigest, ...core } = readiness;
  const forgedCore = {
    ...core,
    reportVersion: "n2-market-baseline-readiness-v2",
    n2TaskId: "TASK-N2-021",
  };
  const forged = {
    ...forgedCore,
    outputDigest: canonicalHash(forgedCore),
  } as unknown as N2MarketBaselineReadinessReport;

  const report = reportFor(forged);

  assert.equal(report.status, "CONFLICT");
  assert.equal(report.stage, "CONFLICT");
  assert.ok(report.blockers.includes("READINESS_IDENTITY_INVALID"));
  assert.ok(!report.blockers.includes("READINESS_OUTPUT_DIGEST_INVALID"));
  assert.deepEqual(report.activationActions, []);
  assert.equal(report.activationPlanningAttemptDelta, 0);
});
