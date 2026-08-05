// Canonical task executor registry facade.
//
// The original executor implementations remain byte-for-byte preserved in
// taskExecutorsCore.ts. This facade extends only the allowlisted resolution
// path with the separately reviewed N2 PIT audit executor.
import { runN2PitAuditExecutor } from "./n2PitAuditExecutor";
import {
  CANARY_COHORT,
  EXECUTORS as CORE_EXECUTORS,
  KNOWN_TASK_TYPES,
  runDatasetCanary,
  runDatasetExpand,
  runDatasetInventory,
  runFeatureCoverageAudit,
  runHoldoutFreeze,
  runPlannerNext,
  runReadonlyAnalysis,
  runReadonlyAudit,
  type Executor,
  type ExecutorContext,
  type ExecutorResult,
} from "./taskExecutorsCore";

export {
  CANARY_COHORT,
  KNOWN_TASK_TYPES,
  runDatasetCanary,
  runDatasetExpand,
  runDatasetInventory,
  runFeatureCoverageAudit,
  runHoldoutFreeze,
  runPlannerNext,
  runReadonlyAnalysis,
  runReadonlyAudit,
};
export type { Executor, ExecutorContext, ExecutorResult };

export const EXECUTOR_REGISTRY_VERSION = "n2-task-executor-registry-v3";

// Compatibility export for existing callers/tests that inspect the legacy core
// list. Runtime resolution below is the authority and includes pit-audit.
export const EXECUTORS: Readonly<Record<string, Executor>> = CORE_EXECUTORS;

const REGISTERED_EXECUTORS: Readonly<Record<string, Executor>> = Object.freeze({
  ...CORE_EXECUTORS,
  "pit-audit": runN2PitAuditExecutor,
});

export function isExecutorImplemented(taskType: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTERED_EXECUTORS, taskType);
}

export function resolveExecutor(taskType: string): {
  executor: Executor | null;
  code: "OK" | "EXECUTOR_NOT_REGISTERED";
} {
  const executor = Object.prototype.hasOwnProperty.call(REGISTERED_EXECUTORS, taskType)
    ? REGISTERED_EXECUTORS[taskType]
    : null;
  return executor ? { executor, code: "OK" } : { executor: null, code: "EXECUTOR_NOT_REGISTERED" };
}
