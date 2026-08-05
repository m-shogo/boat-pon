import assert from "node:assert/strict";
import test from "node:test";
import { validatePublicDashboardSnapshot } from "./publicSnapshot";
import { buildPublicDashboardSnapshot } from "./publicSnapshotBuilder";
import {
  sealPublicDashboardSnapshot,
  verifyPublicDashboardSnapshotIntegrity,
} from "./publicSnapshotTransport";

const catalog = {
  tasks: [
    {
      taskId: "TASK-N2-001",
      title: "dataset canary",
      dependencies: [],
    },
    {
      taskId: "TASK-PLANNER-NEXT",
      title: "queue planner",
      dependencies: [],
    },
    {
      taskId: "TASK-N2-010",
      title: "corrected dataset年代拡張",
      dependencies: ["TASK-N2-001"],
    },
    {
      taskId: "TASK-N2-011",
      title: "PIT再検証",
      dependencies: ["TASK-N2-010"],
    },
    {
      taskId: "TASK-N2-022",
      title: "common cohort baseline比較",
      dependencies: ["TASK-N2-011"],
    },
  ],
};

const queueState = {
  updatedAt: "2026-08-05T09:00:00.000Z",
  tasks: {
    "TASK-N2-001": {
      status: "PASS",
      evidenceLinks: ["reports/n2/canary.json"],
      updatedAt: "2026-08-04T09:00:00.000Z",
    },
    "TASK-PLANNER-NEXT": {
      status: "READY",
      evidenceLinks: [],
      updatedAt: "2026-08-04T15:00:00.000Z",
    },
    "TASK-N2-010": {
      status: "READY",
      evidenceLinks: [],
      updatedAt: "2026-08-05T09:00:00.000Z",
    },
    "TASK-N2-011": {
      status: "BLOCKED_EXECUTOR_PENDING",
      evidenceLinks: [],
      updatedAt: "2026-08-05T09:00:00.000Z",
    },
    "TASK-N2-022": {
      status: "BLOCKED_EXECUTOR_PENDING",
      evidenceLinks: [],
      updatedAt: "2026-08-05T09:00:00.000Z",
    },
  },
};

const readiness = {
  evaluatedAt: "2026-08-05T08:59:00.000Z",
  verdict: "PASS",
  pendingTask: "TASK-N2-010 (READY, dataset-expand)",
  checks: [
    { name: "n2_001to006_PASS", status: "PASS" },
    { name: "holdoutFreezePresent", status: "PASS" },
  ],
};

const currentRun = {
  updatedAt: "2026-08-05T08:58:00.000Z",
  lastResult: "FAILED",
  blocks: ["private diagnostic that must not be copied"],
};

test("builder exposes task authority without private execution details", async () => {
  const built = buildPublicDashboardSnapshot({
    catalog,
    queueState,
    readiness,
    currentRun,
    generatedAt: "2026-08-05T09:01:00.000Z",
    modelVersion: "boat-pon-main:864e720",
  });

  assert.equal(built.status.nextTask, "TASK-N2-010");
  assert.equal(built.status.runner, "BLOCKED");
  assert.equal(built.status.readiness, "PASS");
  assert.equal(built.status.snapshotFreshness, "FRESH");
  assert.equal(built.dataAsOf, "2026-08-05T09:00:00.000Z");
  assert.equal(built.dataQuality.pitStatus, "ENGINEERING_REQUIRED");
  assert.equal(built.dataQuality.holdoutStatus, "PASS");
  assert.equal(built.dataQuality.commonCohortStatus, "ENGINEERING_REQUIRED");
  assert.equal(built.registries.experiments, null);
  assert.equal(built.metrics.length, 0);

  const serialized = JSON.stringify(built);
  assert.doesNotMatch(serialized, /private diagnostic/);
  assert.deepEqual(findForbiddenKeys(built), []);

  const validation = validatePublicDashboardSnapshot(built);
  assert.equal(validation.ok, true, validation.errors.join("\n"));

  const sealed = await sealPublicDashboardSnapshot(built);
  const verified = await verifyPublicDashboardSnapshotIntegrity(sealed);
  assert.equal(verified.ok, true, verified.errors.join("\n"));
});

test("builder maps running task ahead of ready tasks", () => {
  const runningQueue = structuredClone(queueState);
  runningQueue.tasks["TASK-N2-010"].status = "RUNNING";
  const built = buildPublicDashboardSnapshot({
    catalog,
    queueState: runningQueue,
    readiness,
    currentRun: { updatedAt: "2026-08-05T09:00:30.000Z", lastResult: "RUNNING" },
    generatedAt: "2026-08-05T09:01:00.000Z",
    modelVersion: "boat-pon-main:864e720",
  });
  assert.equal(built.status.nextTask, "TASK-N2-010");
  assert.equal(built.status.runner, "RUNNING");
});

test("builder declares stale authority instead of refreshing it by generation time", () => {
  const built = buildPublicDashboardSnapshot({
    catalog,
    queueState,
    readiness,
    currentRun,
    generatedAt: "2026-08-05T12:01:00.000Z",
    modelVersion: "boat-pon-main:864e720",
  });
  assert.equal(built.dataAsOf, "2026-08-05T09:00:00.000Z");
  assert.equal(built.status.snapshotFreshness, "STALE");
});

test("invalid generation metadata fails before a public artifact is created", () => {
  assert.throws(() => buildPublicDashboardSnapshot({
    catalog,
    queueState,
    readiness,
    currentRun,
    generatedAt: "not-a-date",
    modelVersion: "boat-pon-main:864e720",
  }), /generatedAt/);

  assert.throws(() => buildPublicDashboardSnapshot({
    catalog,
    queueState,
    readiness,
    currentRun,
    generatedAt: "2026-08-05T09:01:00.000Z",
    modelVersion: "   ",
  }), /modelVersion/);
});

function findForbiddenKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => findForbiddenKeys(item, found));
    return found;
  }
  if (typeof value !== "object" || value === null) return found;

  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
    if (["selection", "recommendedamount", "currentodds", "requiredodds", "stake"].some((item) => normalized.includes(item))) {
      found.push(key);
    }
    findForbiddenKeys(child, found);
  }
  return found;
}
