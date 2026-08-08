import { join } from "node:path";

import { canonicalHash } from "../research-replay/canonical";
import {
  N2_COMMON_COHORT_REQUIRED_BASELINES,
  N2_COMMON_COHORT_REQUIRED_ROWS,
} from "../research-replay/n2CommonCohortEvaluation";
import {
  N2_ECONOMIC_METRICS_EVALUATION_VERSION,
} from "../research-replay/n2EconomicMetricsEvaluation";
import {
  N2_METRICS_REQUIRED_BASELINE_COUNT,
  N2_METRICS_REQUIRED_COMMON_ROWS,
  buildN2MetricsDefinition,
} from "../research-replay/n2MetricsContract";
import {
  atomicWriteJson,
  runExecutorLifecycle,
  verifyJsonReadback,
  type ExecutorSpec,
  type SdkContext,
} from "../research/governance/executorSdk";
import type { Executor, ExecutorResult } from "./taskExecutors";

export const N2_METRICS_DEFINITION_EXECUTOR_VERSION =
  "n2-metrics-definition-executor-v1" as const;
const REPORT_RELATIVE_PATH = "reports/n2/n2-metrics-definition.json";

export const runN2MetricsDefinitionExecutor: Executor = (ctx) => {
  const sdkCtx: SdkContext = {
    repoRoot: ctx.repoRoot,
    runId: ctx.runId,
    taskId: ctx.taskId,
    dataRoot: ctx.repoRoot,
    dryRun: ctx.dryRun,
    writeAllowlist: ["reports/n2/"],
  };
  const spec: ExecutorSpec = {
    name: "metrics-eval",
    safetyLevel: "L0",
    implemented: true,
    inputContract: () => {
      const errors: string[] = [];
      if (ctx.taskStatuses["TASK-N2-022"] !== "PASS") {
        errors.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-022=${ctx.taskStatuses["TASK-N2-022"] ?? "UNKNOWN"}`);
      }
      if (N2_METRICS_REQUIRED_BASELINE_COUNT !== N2_COMMON_COHORT_REQUIRED_BASELINES) {
        errors.push(`BASELINE_COUNT_CONTRACT_DRIFT:${N2_METRICS_REQUIRED_BASELINE_COUNT}/${N2_COMMON_COHORT_REQUIRED_BASELINES}`);
      }
      if (N2_METRICS_REQUIRED_COMMON_ROWS !== N2_COMMON_COHORT_REQUIRED_ROWS) {
        errors.push(`COMMON_ROW_CONTRACT_DRIFT:${N2_METRICS_REQUIRED_COMMON_ROWS}/${N2_COMMON_COHORT_REQUIRED_ROWS}`);
      }
      return { ok: errors.length === 0, errors };
    },
    executeReadOnly: () => {
      const definition = buildN2MetricsDefinition();
      const summary = {
        reportVersion: "n2-metrics-definition-report-v1",
        executorContractVersion: N2_METRICS_DEFINITION_EXECUTOR_VERSION,
        status: "FROZEN",
        definition,
        compatibility: {
          commonCohortRequiredBaselineCount: N2_COMMON_COHORT_REQUIRED_BASELINES,
          commonCohortRequiredRows: N2_COMMON_COHORT_REQUIRED_ROWS,
          economicEvaluatorVersion: N2_ECONOMIC_METRICS_EVALUATION_VERSION,
          contractDriftDetected: false,
        },
        dataAccess: {
          privateMarketReadCount: 0,
          settlementReadCount: 0,
          databaseReadCount: 0,
          databaseWriteCount: 0,
          networkRequestCount: 0,
        },
        automaticPromotionAuthorized: false,
        currentBuyConnectionAuthorized: false,
        lineConnectionAuthorized: false,
        publicPublishAuthorized: false,
        automatedBettingAuthorized: false,
        productionApplyExecuted: false,
      };
      return {
        outputs: [REPORT_RELATIVE_PATH],
        digest: canonicalHash(summary),
        summary,
      };
    },
    pitEvidence: (_sdk, artifact) => ({
      status: "PASS",
      validatorId: "n2-metrics-definition-no-data-read",
      validatorVersion: N2_METRICS_DEFINITION_EXECUTOR_VERSION,
      checkedRecordCount: 0,
      sameRaceViolationCount: 0,
      futureViolationCount: 0,
      ambiguousTimingCount: 0,
      evidencePath: REPORT_RELATIVE_PATH,
      evidenceDigest: artifact.digest,
      notApplicableReason: "definition_only_no_prediction_or_settlement_data_read",
    }),
    writeArtifacts: (sdk, artifact) => {
      try {
        const payload = {
          ...artifact.summary,
          runId: ctx.runId,
          requestId: ctx.requestId,
          taskId: ctx.taskId,
          executorVersion: N2_METRICS_DEFINITION_EXECUTOR_VERSION,
          generatedAt: new Date().toISOString(),
          outputDigest: artifact.digest,
        };
        atomicWriteJson(join(sdk.repoRoot, REPORT_RELATIVE_PATH), payload, true);
        return { ok: true, errors: [], outputs: [REPORT_RELATIVE_PATH] };
      } catch (error) {
        return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
      }
    },
    verifyArtifacts: (sdk, artifact) => verifyJsonReadback(
      join(sdk.repoRoot, REPORT_RELATIVE_PATH),
      artifact.digest,
    ),
    recordEvidence: (_sdk, _artifact, outputs) => ({ ok: true, errors: [], outputs }),
    finalizeEvidence: (_sdk, _artifact, outputs) => ({ ok: true, errors: [], outputs }),
  };

  const outcome = runExecutorLifecycle(spec, sdkCtx);
  const result: ExecutorResult["result"] = outcome.result === "ENGINEERING_REQUIRED"
    ? "BLOCKED"
    : outcome.result;
  return {
    result,
    executorVersion: N2_METRICS_DEFINITION_EXECUTOR_VERSION,
    summary: outcome.summary,
    outputs: outcome.outputs,
    outputDigest: outcome.digest || canonicalHash(outcome.summary),
    blocks: outcome.blocks,
  };
};
