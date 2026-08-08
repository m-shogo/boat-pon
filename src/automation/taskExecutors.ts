// Canonical task executor registry facade.
//
// The original executor implementations remain byte-for-byte preserved in
// taskExecutorsCore.ts. This facade extends only the allowlisted resolution
// path with separately reviewed N2 executors.
import { runN2ObservationIngestReadinessExecutor } from "./n2ObservationIngestReadinessExecutor";
import { runN2OfficialProgramCanaryReviewBundleExecutor } from "./n2OfficialProgramCanaryReviewBundleExecutor";
import { runN2PitAuditExecutor } from "./n2PitAuditExecutor";
import {
  CANARY_COHORT,
  EXECUTORS as CORE_EXECUTORS,
  KNOWN_TASK_TYPES as CORE_KNOWN_TASK_TYPES,
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

export const EXECUTOR_REGISTRY_VERSION = "n2-task-executor-registry-v5";

export const KNOWN_TASK_TYPES = [
  ...CORE_KNOWN_TASK_TYPES,
  "observation-ingest-readiness",
  "official-program-canary-review-bundle",
] as const;

// Compatibility export for existing callers/tests that inspect the legacy core
// list. Runtime resolution below is the authority and includes reviewed N2 additions.
export const EXECUTORS: Readonly<Record<string, Executor>> = CORE_EXECUTORS;

const REGISTERED_EXECUTORS: Readonly<Record<string, Executor>> = Object.freeze({
  ...CORE_EXECUTORS,
  "pit-audit": runN2PitAuditExecutor,
  "observation-ingest-readiness": runN2ObservationIngestReadinessExecutor,
  "official-program-canary-review-bundle": runN2OfficialProgramCanaryReviewBundleExecutor,
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
