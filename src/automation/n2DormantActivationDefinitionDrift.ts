import { N2_DORMANT_TASKS, type N2DormantTaskId } from "./n2DormantActivationContract";
import type { QueueState, TaskCatalog } from "./taskCatalog";

const N2_DORMANT_MAX_ATTEMPTS = 3;

const N2_DORMANT_TASK_TYPES: Record<N2DormantTaskId, string> = {
  "TASK-N2-020": "baseline-market",
  "TASK-N2-021": "baseline-historical",
  "TASK-N2-022": "baseline-common-cohort",
  "TASK-N2-030": "evaluation-metrics",
  "TASK-N2-040": "edge-hypothesis-scan",
  "TASK-N2-041": "edge-historical-test",
  "TASK-N2-042": "confounder-audit",
};

const N2_DORMANT_TASK_DEFINITION_VERSIONS: Record<N2DormantTaskId, number> = {
  "TASK-N2-020": 1,
  "TASK-N2-021": 1,
  "TASK-N2-022": 1,
  "TASK-N2-030": 1,
  "TASK-N2-040": 1,
  "TASK-N2-041": 1,
  "TASK-N2-042": 1,
};

const N2_DORMANT_TASK_DEPENDENCIES: Record<N2DormantTaskId, readonly string[]> = {
  "TASK-N2-020": ["TASK-N2-011", "TASK-N2-005"],
  "TASK-N2-021": ["TASK-N2-011", "TASK-N2-005"],
  "TASK-N2-022": ["TASK-N2-020", "TASK-N2-021"],
  "TASK-N2-030": ["TASK-N2-022"],
  "TASK-N2-040": ["TASK-N2-030"],
  "TASK-N2-041": ["TASK-N2-040"],
  "TASK-N2-042": ["TASK-N2-041"],
};

function sameDependencySet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

export function findN2DormantTaskDefinitionDrift(
  catalog: TaskCatalog,
  state: QueueState,
): string[] {
  const issues: string[] = [];
  if (catalog.catalogVersion !== state.catalogVersion) {
    issues.push("CATALOG_VERSION_MISMATCH");
  }
  const catalogById = new Map(catalog.tasks.map((task) => [task.taskId, task]));
  for (const taskId of N2_DORMANT_TASKS) {
    const catalogTask = catalogById.get(taskId);
    const queueTask = state.tasks[taskId];
    if (!catalogTask) issues.push(`${taskId}:CATALOG_TASK_MISSING`);
    if (!queueTask) issues.push(`${taskId}:QUEUE_TASK_MISSING`);
    if (catalogTask && catalogTask.taskDefinitionVersion !== N2_DORMANT_TASK_DEFINITION_VERSIONS[taskId]) {
      issues.push(`${taskId}:CATALOG_TASK_DEFINITION_VERSION_MISMATCH`);
    }
    if (catalogTask && catalogTask.taskType !== N2_DORMANT_TASK_TYPES[taskId]) {
      issues.push(`${taskId}:CATALOG_TASK_TYPE_MISMATCH`);
    }
    if (catalogTask && catalogTask.executor !== N2_DORMANT_TASK_TYPES[taskId]) {
      issues.push(`${taskId}:CATALOG_EXECUTOR_MISMATCH`);
    }
    if (catalogTask && catalogTask.safetyLevel !== "L0") {
      issues.push(`${taskId}:CATALOG_SAFETY_LEVEL_MISMATCH`);
    }
    if (catalogTask && !sameDependencySet(catalogTask.dependencies, N2_DORMANT_TASK_DEPENDENCIES[taskId])) {
      issues.push(`${taskId}:CATALOG_DEPENDENCIES_MISMATCH`);
    }
    if (catalogTask && queueTask && catalogTask.taskDefinitionVersion !== queueTask.taskDefinitionVersion) {
      issues.push(`${taskId}:TASK_DEFINITION_VERSION_MISMATCH`);
    }
    if (queueTask?.status === "BLOCKED_EXECUTOR_PENDING") {
      if (queueTask.attemptCount !== 0) issues.push(`${taskId}:DORMANT_ATTEMPT_COUNT_NOT_ZERO`);
      if (queueTask.maxAttempts !== N2_DORMANT_MAX_ATTEMPTS) issues.push(`${taskId}:DORMANT_MAX_ATTEMPTS_MISMATCH`);
      if (queueTask.authoritySha !== null) issues.push(`${taskId}:DORMANT_AUTHORITY_SHA_PRESENT`);
      if (queueTask.evidenceLinks.length !== 0) issues.push(`${taskId}:DORMANT_EVIDENCE_PRESENT`);
      if (queueTask.resultDigest !== null) issues.push(`${taskId}:DORMANT_RESULT_DIGEST_PRESENT`);
      if (queueTask.lastFailure !== null) issues.push(`${taskId}:DORMANT_LAST_FAILURE_PRESENT`);
      if (queueTask.checkpoint !== null) issues.push(`${taskId}:DORMANT_CHECKPOINT_PRESENT`);
    }
  }
  return issues;
}
