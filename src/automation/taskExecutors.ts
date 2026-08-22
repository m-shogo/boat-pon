// Canonical task executor registry facade.
//
// The original executor implementations remain byte-for-byte preserved in
// taskExecutorsCore.ts. This facade extends only the allowlisted resolution
// path with separately reviewed N2 executors.
import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { canonicalHash } from "../research-replay/canonical";
import { readCurrentlyValidSourceDuplicateObservationIds } from "../research-replay/n1SourceDuplicateResolutionValidation";
import { runN2ObservationIngestReadinessExecutor } from "./n2ObservationIngestReadinessExecutor";
import { runN2OfficialProgramCanaryReviewBundleExecutor } from "./n2OfficialProgramCanaryReviewBundleExecutor";
import { runN2PitAuditExecutor } from "./n2PitAuditExecutor";
import {
  CANARY_COHORT,
  EXECUTORS as CORE_EXECUTORS,
  KNOWN_TASK_TYPES as CORE_KNOWN_TASK_TYPES,
  runDatasetCanary as runDatasetCanaryCore,
  runDatasetExpand as runDatasetExpandCore,
  runDatasetInventory,
  runFeatureCoverageAudit,
  runHoldoutFreeze,
  runPlannerNext,
  runReadonlyAnalysis as runReadonlyAnalysisCore,
  runReadonlyAudit as runReadonlyAuditCore,
  type Executor,
  type ExecutorContext,
  type ExecutorResult,
} from "./taskExecutorsCore";

export const EXECUTOR_REGISTRY_VERSION = "n2-task-executor-registry-v5";

function withCurrentSourceDuplicateEvidence(executor: Executor): Executor {
  return (ctx) => {
    if (!existsSync(ctx.sidecarPath)) return executor(ctx);
    const walPath = `${ctx.sidecarPath}-wal`;
    if (existsSync(walPath) && statSync(walPath).size > 0) return executor(ctx);

    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(`${pathToFileURL(ctx.sidecarPath).href}?immutable=1`, { readOnly: true } as never);
      db.exec("PRAGMA query_only=ON");
      const hasResolutionTable = Boolean(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='settlement_source_duplicate_resolutions_v2'",
      ).get());
      if (!hasResolutionTable) return executor(ctx);
      readCurrentlyValidSourceDuplicateObservationIds(db);
    } catch {
      const blocks = ["SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"];
      return {
        result: "BLOCKED",
        executorVersion: EXECUTOR_REGISTRY_VERSION,
        summary: { blocks },
        outputs: [],
        outputDigest: canonicalHash({ blocks }),
        blocks,
      };
    } finally {
      db?.close();
    }
    return executor(ctx);
  };
}

// These legacy core executors filter source duplicates directly in SQL. Bind
// them to the current append-only resolution semantics before they can emit
// reports or registry evidence. The core implementations remain unchanged.
export const runDatasetCanary = withCurrentSourceDuplicateEvidence(runDatasetCanaryCore);
export const runReadonlyAnalysis = withCurrentSourceDuplicateEvidence(runReadonlyAnalysisCore);
export const runReadonlyAudit = withCurrentSourceDuplicateEvidence(runReadonlyAuditCore);
export const runDatasetExpand = withCurrentSourceDuplicateEvidence(runDatasetExpandCore);

export {
  CANARY_COHORT,
  runDatasetInventory,
  runFeatureCoverageAudit,
  runHoldoutFreeze,
  runPlannerNext,
};
export type { Executor, ExecutorContext, ExecutorResult };

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
  "dataset-canary": runDatasetCanary,
  "readonly-analysis": runReadonlyAnalysis,
  "readonly-audit": runReadonlyAudit,
  "dataset-expand": runDatasetExpand,
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
