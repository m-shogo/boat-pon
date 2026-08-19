import { dirname, join } from "node:path";

import { canonicalHash } from "../research-replay/canonical";
import {
  N2_COMMON_COHORT_EVALUATION_VERSION,
  evaluateN2CommonCohort,
} from "../research-replay/n2CommonCohortEvaluation";
import {
  readN2HistoricalOnlyBaselineSources,
  type N2HistoricalOnlyBaselineSourceRead,
} from "../research-replay/n2HistoricalOnlyBaselineSource";
import {
  readN2MarketOnlyBaselinePrivateSources,
  type N2MarketOnlyBaselinePrivateSourceRead,
} from "../research-replay/n2MarketOnlyBaselinePrivateSource";
import {
  readN2T5DecisionCutoffMetadata,
  type N2T5DecisionCutoffMetadataRead,
} from "../research-replay/n2T5DecisionCutoffMetadata";
import {
  atomicWriteJson,
  runExecutorLifecycle,
  verifyJsonReadback,
  type ExecutorSpec,
  type SdkContext,
} from "../research/governance/executorSdk";
import type { Executor, ExecutorResult } from "./taskExecutors";

export const N2_COMMON_COHORT_BASELINE_EXECUTOR_VERSION =
  "n2-common-cohort-baseline-executor-v2" as const;
const REPORT_RELATIVE_PATH = "reports/n2/n2-baseline-common-cohort.json";

type MarketReader = typeof readN2MarketOnlyBaselinePrivateSources;
type HistoricalReader = typeof readN2HistoricalOnlyBaselineSources;
type CutoffReader = typeof readN2T5DecisionCutoffMetadata;

function sanitizedMarketSource(read: N2MarketOnlyBaselinePrivateSourceRead): Record<string, unknown> {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
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

function sanitizedHistoricalSource(read: N2HistoricalOnlyBaselineSourceRead): Record<string, unknown> {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
    readinessStatus: read.readinessStatus,
    readinessDigest: read.readinessDigest,
    acceptedT5RaceCount: read.acceptedT5RaceCount,
    settledAcceptedT5RaceCount: read.settledAcceptedT5RaceCount,
    selectedCohortRaceCount: read.selectedCohortRaceCount,
    historicalTrainingRaceCount: read.historicalTrainingRaceCount,
    trainingFromDateInclusive: read.trainingFromDateInclusive,
    trainingToDateInclusive: read.trainingToDateInclusive,
    databaseReadCount: read.databaseReadCount,
    databaseWriteCount: read.databaseWriteCount,
    networkRequestCount: read.networkRequestCount,
    rawOddsValuesRead: read.rawOddsValuesRead,
    liveOnlyFeatureReadCount: read.liveOnlyFeatureReadCount,
    publicPublishAuthorized: read.publicPublishAuthorized,
    productionApplyExecuted: read.productionApplyExecuted,
  };
}

function sanitizedCutoffSource(read: N2T5DecisionCutoffMetadataRead): Record<string, unknown> {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
    alignedRaceCount: Object.keys(read.decisionCutoffByRaceKey).length,
    privateEnvelopeMetadataReadCount: read.privateEnvelopeMetadataReadCount,
    rawOddsValuesRead: read.rawOddsValuesRead,
    networkRequestCount: read.networkRequestCount,
    databaseReadCount: read.databaseReadCount,
    databaseWriteCount: read.databaseWriteCount,
    publicPublishAuthorized: read.publicPublishAuthorized,
    productionApplyExecuted: read.productionApplyExecuted,
  };
}

export function createN2CommonCohortBaselineExecutor(
  marketReader: MarketReader = readN2MarketOnlyBaselinePrivateSources,
  historicalReader: HistoricalReader = readN2HistoricalOnlyBaselineSources,
  cutoffReader: CutoffReader = readN2T5DecisionCutoffMetadata,
): Executor {
  return (ctx) => {
    const dataRoot = dirname(dirname(ctx.sidecarPath));
    let marketRead: N2MarketOnlyBaselinePrivateSourceRead | null = null;
    let historicalRead: N2HistoricalOnlyBaselineSourceRead | null = null;
    let cutoffRead: N2T5DecisionCutoffMetadataRead | null = null;
    const sdkCtx: SdkContext = {
      repoRoot: ctx.repoRoot,
      runId: ctx.runId,
      taskId: ctx.taskId,
      dataRoot,
      dryRun: ctx.dryRun,
      writeAllowlist: ["reports/n2/"],
    };
    const spec: ExecutorSpec = {
      name: "baseline-common-cohort",
      safetyLevel: "L0",
      implemented: true,
      inputContract: () => {
        const errors: string[] = [];
        for (const dependency of ["TASK-N2-020", "TASK-N2-021"]) {
          if (ctx.taskStatuses[dependency] !== "PASS") {
            errors.push(`DEPENDENCY_NOT_SATISFIED:${dependency}=${ctx.taskStatuses[dependency] ?? "UNKNOWN"}`);
          }
        }
        if (errors.length > 0) return { ok: false, errors };

        marketRead = marketReader({ dataRoot, sidecarDbPath: ctx.sidecarPath });
        if (marketRead.status !== "PASS") {
          errors.push(...marketRead.blockers.map((blocker) => `COMMON_COHORT_MARKET_${blocker}`));
          return { ok: false, errors };
        }
        historicalRead = historicalReader({ dataRoot, sidecarDbPath: ctx.sidecarPath });
        if (historicalRead.status !== "PASS") {
          errors.push(...historicalRead.blockers.map((blocker) => `COMMON_COHORT_HISTORICAL_${blocker}`));
          return { ok: false, errors };
        }
        cutoffRead = cutoffReader({
          dataRoot,
          raceKeys: historicalRead.evaluationRaces.map((row) => row.canonicalRaceKey),
        });
        if (cutoffRead.status !== "PASS") {
          errors.push(...cutoffRead.blockers.map((blocker) => `COMMON_COHORT_CUTOFF_${blocker}`));
        }
        return { ok: errors.length === 0, errors };
      },
      executeReadOnly: () => {
        if (!marketRead || marketRead.status !== "PASS"
          || !historicalRead || historicalRead.status !== "PASS"
          || !cutoffRead || cutoffRead.status !== "PASS") {
          throw new Error("COMMON_COHORT_SOURCES_NOT_READY");
        }
        const comparison = evaluateN2CommonCohort({
          marketSources: marketRead.sources,
          historicalTraining: historicalRead.training,
          evaluationRaces: historicalRead.evaluationRaces,
          decisionCutoffByRaceKey: cutoffRead.decisionCutoffByRaceKey,
        });
        if (comparison.status !== "COMPARABLE") {
          throw new Error(`COMMON_COHORT_BLOCKED:${comparison.blockers.join(",")}`);
        }
        const summary = {
          reportVersion: "n2-baseline-common-cohort-report-v2",
          executorContractVersion: N2_COMMON_COHORT_BASELINE_EXECUTOR_VERSION,
          evaluationVersion: N2_COMMON_COHORT_EVALUATION_VERSION,
          status: comparison.status,
          requiredBaselineCount: comparison.requiredBaselineCount,
          requiredCommonRowCount: comparison.requiredCommonRowCount,
          baselineIds: comparison.baselineIds,
          baselineKinds: comparison.baselineKinds,
          baselineInputRowCounts: comparison.baselineInputRowCounts,
          commonRowCount: comparison.commonRowCount,
          commonPositiveCount: comparison.commonPositiveCount,
          excludedOutsideCommonCohort: comparison.excludedOutsideCommonCohort,
          baselineMetrics: comparison.baselineMetrics,
          commonCohortDigest: comparison.commonCohortDigest,
          comparisonDigest: comparison.comparisonDigest,
          marketDatasetDigest: comparison.marketDatasetDigest,
          historicalDatasetDigest: comparison.historicalDatasetDigest,
          legacyDatasetDigest: comparison.legacyDatasetDigest,
          marketSource: sanitizedMarketSource(marketRead),
          historicalSource: sanitizedHistoricalSource(historicalRead),
          cutoffSource: sanitizedCutoffSource(cutoffRead),
          privacy: {
            rawMarketValuesUsedForMarketMetrics: true,
            rawMarketValuesPersisted: false,
            rowLevelPredictionsPersisted: false,
            winningSelectionsPersisted: false,
            raceKeysPersisted: false,
            privatePathsPersisted: false,
          },
          pit: {
            exactDecisionCutoffMatchRequired: true,
            exactLabelMatchRequired: true,
            exactCommonRowsRequired: comparison.requiredCommonRowCount,
            historicalSameDayLabelBorrow: false,
            legacySameDayLabelBorrow: false,
            currentRaceFeatureRead: false,
            result: "PASS",
          },
          networkRequestCount: 0,
          sidecarWriteCount: 0,
          primaryDbReadCount: 0,
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
        validatorId: "n2-common-cohort-exact-row-pit",
        validatorVersion: N2_COMMON_COHORT_BASELINE_EXECUTOR_VERSION,
        checkedRecordCount: Number(artifact.summary.commonRowCount ?? 0),
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
            executorVersion: N2_COMMON_COHORT_BASELINE_EXECUTOR_VERSION,
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
      executorVersion: N2_COMMON_COHORT_BASELINE_EXECUTOR_VERSION,
      summary: outcome.summary,
      outputs: outcome.outputs,
      outputDigest: outcome.digest || canonicalHash(outcome.summary),
      blocks: outcome.blocks,
    };
  };
}

export const runN2CommonCohortBaselineExecutor = createN2CommonCohortBaselineExecutor();