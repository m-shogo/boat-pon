import { N2_DORMANT_TASKS, type N2DormantTaskId } from "./n2DormantActivationContract";
import type { QueueState, TaskCatalog } from "./taskCatalog";

const N2_DORMANT_TASK_TYPES: Record<N2DormantTaskId, string> = {
  "TASK-N2-020": "baseline-market",
  "TASK-N2-021": "baseline-historical",
  "TASK-N2-022": "baseline-common-cohort",
  "TASK-N2-030": "evaluation-metrics",
  "TASK-N2-040": "edge-hypothesis-scan",
  "TASK-N2-041": "edge-historical-test",
  "TASK-N2-042": "confounder-audit",
};

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
    if (catalogTask && catalogTask.taskType !== N2_DORMANT_TASK_TYPES[taskId]) {
      issues.push(`${taskId}:CATALOG_TASK_TYPE_MISMATCH`);
    }
    if (catalogTask && catalogTask.executor !== N2_DORMANT_TASK_TYPES[taskId]) {
      issues.push(`${taskId}:CATALOG_EXECUTOR_MISMATCH`);
    }
    if (catalogTask && queueTask && catalogTask.taskDefinitionVersion !== queueTask.taskDefinitionVersion) {
      issues.push(`${taskId}:TASK_DEFINITION_VERSION_MISMATCH`);
    }
  }
  return issues;
}
