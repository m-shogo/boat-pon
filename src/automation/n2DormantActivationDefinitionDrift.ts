import { N2_DORMANT_TASKS } from "./n2DormantActivationContract";
import type { QueueState, TaskCatalog } from "./taskCatalog";

export function findN2DormantTaskDefinitionDrift(
  catalog: TaskCatalog,
  state: QueueState,
): string[] {
  const catalogById = new Map(catalog.tasks.map((task) => [task.taskId, task]));
  return N2_DORMANT_TASKS.flatMap((taskId) => {
    const catalogTask = catalogById.get(taskId);
    const queueTask = state.tasks[taskId];
    if (!catalogTask || !queueTask || catalogTask.taskDefinitionVersion === queueTask.taskDefinitionVersion) {
      return [];
    }
    return [`${taskId}:TASK_DEFINITION_VERSION_MISMATCH`];
  });
}
