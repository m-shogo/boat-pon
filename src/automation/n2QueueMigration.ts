import { computeStateDigest, validateQueueState, type QueueState, type TaskState } from "./taskCatalog";

export const N2_011_TASK_ID = "TASK-N2-011";
export const N2_013_TASK_ID = "TASK-N2-013";
export const N2_011_TARGET_CATALOG_VERSION = "2026-08-06-n2-governance-v8";
export const N2_011_TARGET_DEFINITION_VERSION = 4;

export type CurrentRunState = {
  runSchemaVersion: "current-run-v1";
  updatedAt: string;
  stateVersion: number;
  stateDigest: string;
  [key: string]: unknown;
};

export type N2011QueueMigrationPlan = {
  migrationVersion: "n2-011-v4-queue-cas-migration-v1";
  changed: boolean;
  fromCatalogVersion: string;
  toCatalogVersion: string;
  fromQueueStateVersion: number;
  fromCurrentRunStateVersion: number;
  toStateVersion: number;
  fromQueueDigest: string;
  toQueueDigest: string;
  preservedEvidenceLinks: string[];
  preservedOtherTaskIds: string[];
  clearedFields: Array<"authoritySha" | "resultDigest" | "lastFailure" | "checkpoint">;
};

export type N2011QueueMigrationResult = {
  changed: boolean;
  nextQueue: QueueState;
  nextCurrentRun: CurrentRunState;
  plan: N2011QueueMigrationPlan;
};

const RFC3339_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function cloneTask(task: TaskState): TaskState {
  return {
    ...task,
    evidenceLinks: [...task.evidenceLinks],
    lastFailure: task.lastFailure ? { ...task.lastFailure } : null,
  };
}

function validateCurrentRun(input: unknown): CurrentRunState {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("current-run must be an object");
  }
  const run = input as Record<string, unknown>;
  if (run.runSchemaVersion !== "current-run-v1") throw new Error("current-run schema mismatch");
  if (!Number.isInteger(run.stateVersion) || (run.stateVersion as number) < 0) throw new Error("current-run stateVersion invalid");
  if (typeof run.stateDigest !== "string" || !/^[0-9a-f]{64}$/.test(run.stateDigest)) throw new Error("current-run stateDigest invalid");
  if (typeof run.updatedAt !== "string" || !RFC3339_TIMESTAMP_RE.test(run.updatedAt) || !Number.isFinite(Date.parse(run.updatedAt))) throw new Error("current-run updatedAt invalid");
  return run as CurrentRunState;
}

function isTargetTaskState(task: TaskState): boolean {
  return task.taskDefinitionVersion === N2_011_TARGET_DEFINITION_VERSION
    && task.status === "READY"
    && task.attemptCount === 2
    && task.maxAttempts === 3
    && task.authoritySha === null
    && task.resultDigest === null
    && task.lastFailure === null
    && task.checkpoint === null;
}

function assertMigrationPreconditions(queue: QueueState): void {
  const target = queue.tasks[N2_011_TASK_ID];
  if (!target) throw new Error(`${N2_011_TASK_ID} missing from queue`);
  if (target.attemptCount !== 2) throw new Error(`${N2_011_TASK_ID} attemptCount must remain 2 (got ${target.attemptCount})`);
  if (target.maxAttempts !== 3) throw new Error(`${N2_011_TASK_ID} maxAttempts must remain 3 (got ${target.maxAttempts})`);
  if (!Array.isArray(target.evidenceLinks) || target.evidenceLinks.length === 0) {
    throw new Error(`${N2_011_TASK_ID} evidenceLinks must be preserved and non-empty`);
  }

  const completedCanary = queue.tasks[N2_013_TASK_ID];
  if (!completedCanary) throw new Error(`${N2_013_TASK_ID} missing from queue`);
  if (completedCanary.status !== "PASS" || completedCanary.attemptCount !== 3 || completedCanary.maxAttempts !== 3) {
    throw new Error(`${N2_013_TASK_ID} must remain PASS at attempt 3/3`);
  }

  const alreadyTarget = queue.catalogVersion === N2_011_TARGET_CATALOG_VERSION && isTargetTaskState(target);
  if (!alreadyTarget) {
    if (target.taskDefinitionVersion !== 3) throw new Error(`${N2_011_TASK_ID} source definition must be v3 before migration`);
    if (target.status !== "CONDITIONAL") throw new Error(`${N2_011_TASK_ID} source status must be CONDITIONAL before migration`);
  }
}

export function migrateN2011QueueToV4(
  queueInput: unknown,
  currentRunInput: unknown,
  opts: { now?: string } = {},
): N2011QueueMigrationResult {
  const queueValidation = validateQueueState(queueInput);
  if (!queueValidation.valid || !queueValidation.state) {
    throw new Error(`queue invalid: ${queueValidation.errors.join("; ")}`);
  }
  const queue = queueValidation.state;
  const currentRun = validateCurrentRun(currentRunInput);
  assertMigrationPreconditions(queue);

  const fromQueueDigest = computeStateDigest(queue);
  const currentAligned = currentRun.stateVersion === queue.stateVersion && currentRun.stateDigest === fromQueueDigest;
  const alreadyMigrated = queue.catalogVersion === N2_011_TARGET_CATALOG_VERSION
    && isTargetTaskState(queue.tasks[N2_011_TASK_ID]);

  const commonPlan = {
    migrationVersion: "n2-011-v4-queue-cas-migration-v1" as const,
    fromCatalogVersion: queue.catalogVersion,
    toCatalogVersion: N2_011_TARGET_CATALOG_VERSION,
    fromQueueStateVersion: queue.stateVersion,
    fromCurrentRunStateVersion: currentRun.stateVersion,
    fromQueueDigest,
    preservedEvidenceLinks: [...queue.tasks[N2_011_TASK_ID].evidenceLinks],
    preservedOtherTaskIds: Object.keys(queue.tasks).filter((id) => id !== N2_011_TASK_ID).sort(),
    clearedFields: ["authoritySha", "resultDigest", "lastFailure", "checkpoint"] as N2011QueueMigrationPlan["clearedFields"],
  };

  if (alreadyMigrated && currentAligned) {
    return {
      changed: false,
      nextQueue: queue,
      nextCurrentRun: currentRun,
      plan: {
        ...commonPlan,
        changed: false,
        toStateVersion: queue.stateVersion,
        toQueueDigest: fromQueueDigest,
      },
    };
  }

  const now = opts.now ?? new Date().toISOString();
  const toStateVersion = Math.max(queue.stateVersion, currentRun.stateVersion) + 1;
  const nextTasks: Record<string, TaskState> = {};
  for (const id of Object.keys(queue.tasks).sort()) nextTasks[id] = cloneTask(queue.tasks[id]);
  nextTasks[N2_011_TASK_ID] = {
    ...cloneTask(queue.tasks[N2_011_TASK_ID]),
    status: "READY",
    taskDefinitionVersion: N2_011_TARGET_DEFINITION_VERSION,
    authoritySha: null,
    resultDigest: null,
    lastFailure: null,
    checkpoint: null,
    attemptCount: 2,
    maxAttempts: 3,
    updatedAt: now,
  };

  const nextQueue: QueueState = {
    ...queue,
    catalogVersion: N2_011_TARGET_CATALOG_VERSION,
    stateVersion: toStateVersion,
    updatedAt: now,
    tasks: nextTasks,
  };
  const nextQueueValidation = validateQueueState(nextQueue);
  if (!nextQueueValidation.valid) throw new Error(`migrated queue invalid: ${nextQueueValidation.errors.join("; ")}`);

  const toQueueDigest = computeStateDigest(nextQueue);
  const nextCurrentRun: CurrentRunState = {
    ...currentRun,
    updatedAt: now,
    stateVersion: toStateVersion,
    stateDigest: toQueueDigest,
  };

  if (nextQueue.tasks[N2_013_TASK_ID].status !== "PASS"
    || nextQueue.tasks[N2_013_TASK_ID].attemptCount !== 3
    || nextQueue.tasks[N2_013_TASK_ID].maxAttempts !== 3) {
    throw new Error(`${N2_013_TASK_ID} changed during migration`);
  }
  for (const id of commonPlan.preservedOtherTaskIds) {
    if (JSON.stringify(nextQueue.tasks[id]) !== JSON.stringify(queue.tasks[id])) {
      throw new Error(`unrelated task changed during migration: ${id}`);
    }
  }

  return {
    changed: true,
    nextQueue,
    nextCurrentRun,
    plan: {
      ...commonPlan,
      changed: true,
      toStateVersion,
      toQueueDigest,
    },
  };
}