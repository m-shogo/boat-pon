import { N2_DORMANT_TASKS } from "./n2DormantActivationContract";
import type { QueueState, TaskCatalog } from "./taskCatalog";

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
    if (catalogTask && queueTask && catalogTask.taskDefinitionVersion !== queueTask.taskDefinitionVersion) {
      issues.push(`${taskId}:TASK_DEFINITION_VERSION_MISMATCH`);
    }
  }
  return issues;
}
