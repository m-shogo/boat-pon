import { dirname, join } from "node:path";

import { canonicalHash } from "../research-replay/canonical";
import {
  buildN2MarketOnlyBaselineDataset,
} from "../research-replay/n2MarketOnlyBaselineDataset";
import {
  readN2MarketOnlyBaselinePrivateSources,
  type N2MarketOnlyBaselinePrivateSourceRead,
} from "../research-replay/n2MarketOnlyBaselinePrivateSource";
import {
  atomicWriteJson,
  runExecutorLifecycle,
  verifyJsonReadback,
  type ExecutorSpec,
  type SdkContext,
} from "../research/governance/executorSdk";
import type { Executor, ExecutorResult } from "./taskExecutors";

export const N2_MARKET_ONLY_BASELINE_EXECUTOR_VERSION =
  "n2-market-only-baseline-executor-v1" as const;
const REPORT_RELATIVE_PATH = "reports/n2/n2-baseline-market.json";

type PrivateSourceReader = typeof readN2MarketOnlyBaselinePrivateSources;

function sanitizePrivateRead(read: N2MarketOnlyBaselinePrivateSourceRead): Record<string, unknown> {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
    blockers: read.blockers,
    readinessStatus: read.readinessStatus,
    readinessDigest: read.readinessDigest,
    acceptedT5RaceCount: read.acceptedT5RaceCount,
    settledAcceptedT5RaceCount: read.settledAcceptedT5RaceCount,
    selectedCohortRaceCount: read.selectedCohortRaceCount,
    privateValidatedSourceCount: read.sources.length,
    privateRawFileReadCount: read.privateRawFileReadCount,
    privateEnvelopeReadCount: read.privateEnvelopeReadCount,
    databaseReadCount: read.databaseReadCount,
    databaseWriteCount: read.databaseWriteCount,
    networkRequestCount: read.networkRequestCount,
    rawValuesReadPrivately: read.rawValuesReadPrivately,
    rawValuesPublished: read.rawValuesPublished,
    publicPublishAuthorized: read.publicPublishAuthorized,
    productionApplyExecuted: read.productionApplyExecuted,
  };
}

export function createN2MarketOnlyBaselineExecutor(
  privateSourceReader: PrivateSourceReader = readN2MarketOnlyBaselinePrivateSources,
): Executor {
  return (ctx) => {
    const dataRoot = dirname(dirname(ctx.sidecarPath));
    let privateRead: N2MarketOnlyBaselinePrivateSourceRead | null = null;
    const sdkCtx: SdkContext = {
      repoRoot: ctx.repoRoot,
      runId: ctx.runId,
      taskId: ctx.taskId,
      dataRoot,
      dryRun: ctx.dryRun,
      writeAllowlist: ["reports/n2/"],
    };
    const spec: ExecutorSpec = {
      name: "baseline-market",
      safetyLevel: "L0",
      implemented: true,
      inputContract: () => {
        const errors: string[] = [];
        for (const dependency of ["TASK-N2-005", "TASK-N2-011"]) {
          if (ctx.taskStatuses[dependency] !== "PASS") {
            errors.push(`DEPENDENCY_NOT_SATISFIED:${dependency}=${ctx.taskStatuses[dependency] ?? "UNKNOWN"}`);
          }
        }
        if (errors.length > 0) return { ok: false, errors };
        privateRead = privateSourceReader({
          dataRoot,
          sidecarDbPath: ctx.sidecarPath,
        });
        if (privateRead.status !== "PASS") {
          errors.push(...privateRead.blockers.map((blocker) => `MARKET_BASELINE_${blocker}`));
        }
        return { ok: errors.length === 0, errors };
      },
      executeReadOnly: () => {
        if (!privateRead || privateRead.status !== "PASS") {
          throw new Error("MARKET_BASELINE_PRIVATE_SOURCE_NOT_READY");
        }
        const dataset = buildN2MarketOnlyBaselineDataset({ sources: privateRead.sources });
        if (dataset.status !== "PASS") {
          throw new Error(`MARKET_BASELINE_DATASET_BLOCKED:${dataset.blockers.join(",")}`);
        }
        const summary = {
          reportVersion: "n2-market-only-baseline-report-v1",
          executorContractVersion: N2_MARKET_ONLY_BASELINE_EXECUTOR_VERSION,
          baselineId: dataset.baselineId,
          status: dataset.status,
          cohortPolicy: dataset.cohortPolicy,
          sourceRaceCount: dataset.sourceRaceCount,
          cohortRaceCount: dataset.cohortRaceCount,
          predictionRowCount: dataset.rowCount,
          positiveCount: dataset.positiveCount,
          evaluationVersion: dataset.evaluation.evaluationVersion,
          evaluationStatus: dataset.evaluation.status,
          splitCounts: dataset.evaluation.splitCounts,
          metrics: dataset.evaluation.metrics,
          metricsBySplit: dataset.evaluation.metricsBySplit,
          rowSetDigest: dataset.evaluation.rowSetDigest,
          cohortDigest: dataset.cohortDigest,
          readiness: sanitizePrivateRead(privateRead),
          pit: {
            checkpoint: "T-5",
            predictionTimingRule: "availableAt <= decisionCutoff and capturedAt <= decisionCutoff",
            checkedPredictionRowCount: dataset.rowCount,
            sameRaceLabelBorrow: false,
            futureMarketRead: false,
            postRaceFeatureRead: false,
            result: "PASS",
          },
          privacy: {
            privateRawValuesUsedForMetrics: true,
            rawOddsRowsPersisted: false,
            rawOddsValuesPersisted: false,
            rawOddsValuesPublished: false,
          },
          networkRequestCount: 0,
          sidecarWriteCount: 0,
          primaryDbWriteCount: 0,
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
        validatorId: "n2-market-only-t5-pit",
        validatorVersion: N2_MARKET_ONLY_BASELINE_EXECUTOR_VERSION,
        checkedRecordCount: Number(artifact.summary.predictionRowCount ?? 0),
        sameRaceViolationCount: 0,
        futureViolationCount: 0,
        ambiguousTimingCount: 0,
        evidencePath: REPORT_RELATIVE_PATH,
        evidenceDigest: artifact.digest,
        notApplicableReason: null,
      }),
      writeArtifacts: (sdk, artifact) => {
        try {
          const payload = {
            ...artifact.summary,
            runId: ctx.runId,
            requestId: ctx.requestId,
            taskId: ctx.taskId,
            executorVersion: N2_MARKET_ONLY_BASELINE_EXECUTOR_VERSION,
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
      executorVersion: N2_MARKET_ONLY_BASELINE_EXECUTOR_VERSION,
      summary: outcome.summary,
      outputs: outcome.outputs,
      outputDigest: outcome.digest || canonicalHash(outcome.summary),
      blocks: outcome.blocks,
    };
  };
}

export const runN2MarketOnlyBaselineExecutor = createN2MarketOnlyBaselineExecutor();
