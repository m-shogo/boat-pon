import assert from "node:assert/strict";
import test from "node:test";
import { computeStateDigest, QUEUE_STATE_SCHEMA_VERSION, type QueueState, type TaskState } from "./taskCatalog";
import {
  N2_011_TARGET_CATALOG_VERSION,
  migrateN2011QueueToV4,
  type CurrentRunState,
} from "./n2QueueMigration";

function task(status: TaskState["status"], over: Partial<TaskState> = {}): TaskState {
  return {
    status,
    taskDefinitionVersion: 1,
    authoritySha: null,
    attemptCount: 1,
    maxAttempts: 3,
    evidenceLinks: ["reports/automation/history/original.json"],
    resultDigest: "0".repeat(64),
    lastFailure: null,
    checkpoint: null,
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...over,
  };
}

function queue(): QueueState {
  return {
    stateSchemaVersion: QUEUE_STATE_SCHEMA_VERSION,
    stateVersion: 46,
    catalogVersion: "2026-08-06-n2-governance-v7",
    updatedAt: "2026-08-06T01:38:22.692Z",
    tasks: {
      "TASK-N2-010": task("PASS", { taskDefinitionVersion: 2, attemptCount: 1 }),
      "TASK-N2-011": task("CONDITIONAL", {
        taskDefinitionVersion: 3,
        authoritySha: "b8d7104483f3299a7b13a26e5d53c57f7bfe3334",
        attemptCount: 2,
        evidenceLinks: [
          "reports/automation/history/31011585102-TASK-N2-011.json",
          "reports/automation/history/31013100745-TASK-N2-011.json",
          "reports/n2/n2-pit-audit.json",
        ],
        resultDigest: "2f6da81d776d931e2df7cf27856fe081c85c5f08af6092818d19f4257c15d746",
        checkpoint: { prior: true },
      }),
      "TASK-N2-013": task("PASS", {
        taskDefinitionVersion: 2,
        attemptCount: 3,
        maxAttempts: 3,
        evidenceLinks: ["reports/automation/history/31063301882-TASK-N2-013.json"],
      }),
      "TASK-N2-020": task("BLOCKED_EXECUTOR_PENDING", { attemptCount: 0, evidenceLinks: [], resultDigest: null }),
    },
  };
}

function currentRun(state: QueueState): CurrentRunState {
  return {
    runSchemaVersion: "current-run-v1",
    updatedAt: "2026-08-06T01:38:22.694Z",
    lastResult: "PASS",
    lastTaskId: "TASK-N2-013",
    stateVersion: 47,
    stateDigest: computeStateDigest(state),
  };
}

test("N2-011 migration upgrades only the target, preserves attempts/evidence, and aligns queue/current-run", () => {
  const before = queue();
  const beforeOtherTasks = JSON.parse(JSON.stringify({
    "TASK-N2-010": before.tasks["TASK-N2-010"],
    "TASK-N2-013": before.tasks["TASK-N2-013"],
    "TASK-N2-020": before.tasks["TASK-N2-020"],
  }));
  const result = migrateN2011QueueToV4(before, currentRun(before), { now: "2026-08-06T07:00:00.000Z" });

  assert.equal(result.changed, true);
  assert.equal(result.nextQueue.catalogVersion, N2_011_TARGET_CATALOG_VERSION);
  assert.equal(result.nextQueue.stateVersion, 48);
  assert.equal(result.nextCurrentRun.stateVersion, 48);
  assert.equal(result.nextCurrentRun.stateDigest, computeStateDigest(result.nextQueue));

  const target = result.nextQueue.tasks["TASK-N2-011"];
  assert.equal(target.status, "READY");
  assert.equal(target.taskDefinitionVersion, 4);
  assert.equal(target.attemptCount, 2);
  assert.equal(target.maxAttempts, 3);
  assert.deepEqual(target.evidenceLinks, before.tasks["TASK-N2-011"].evidenceLinks);
  assert.equal(target.authoritySha, null);
  assert.equal(target.resultDigest, null);
  assert.equal(target.lastFailure, null);
  assert.equal(target.checkpoint, null);

  assert.deepEqual({
    "TASK-N2-010": result.nextQueue.tasks["TASK-N2-010"],
    "TASK-N2-013": result.nextQueue.tasks["TASK-N2-013"],
    "TASK-N2-020": result.nextQueue.tasks["TASK-N2-020"],
  }, beforeOtherTasks);
  assert.equal(result.nextQueue.tasks["TASK-N2-013"].status, "PASS");
  assert.equal(result.nextQueue.tasks["TASK-N2-013"].attemptCount, 3);
});

test("N2-011 migration re-run is NO_CHANGE and preserves object identity", () => {
  const before = queue();
  const first = migrateN2011QueueToV4(before, currentRun(before), { now: "2026-08-06T07:00:00.000Z" });
  const second = migrateN2011QueueToV4(first.nextQueue, first.nextCurrentRun, { now: "2026-08-06T08:00:00.000Z" });

  assert.equal(second.changed, false);
  assert.equal(second.nextQueue, first.nextQueue);
  assert.equal(second.nextCurrentRun, first.nextCurrentRun);
  assert.equal(second.nextQueue.stateVersion, 48);
});

test("N2-011 migration fails closed when the final attempt budget or completed canary changes", () => {
  const wrongAttempt = queue();
  wrongAttempt.tasks["TASK-N2-011"].attemptCount = 1;
  assert.throws(() => migrateN2011QueueToV4(wrongAttempt, currentRun(wrongAttempt)), /attemptCount must remain 2/);

  const reopenedCanary = queue();
  reopenedCanary.tasks["TASK-N2-013"].status = "READY";
  assert.throws(() => migrateN2011QueueToV4(reopenedCanary, currentRun(reopenedCanary)), /must remain PASS at attempt 3\/3/);
});

test("N2-011 migration rejects malformed current-run timestamps", () => {
  const before = queue();
  const base = currentRun(before);
  for (const updatedAt of ["not-a-time", "2026-08-06", "2026-08-06T01:38:22"]) {
    assert.throws(
      () => migrateN2011QueueToV4(before, { ...base, updatedAt }),
      /current-run updatedAt invalid/,
      updatedAt,
    );
  }
  assert.doesNotThrow(() => migrateN2011QueueToV4(before, { ...base, updatedAt: "2026-08-06T10:38:22+09:00" }));
});
