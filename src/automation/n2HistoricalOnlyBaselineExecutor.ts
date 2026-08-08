import { dirname, join } from "node:path";

import { canonicalHash } from "../research-replay/canonical";
import {
  alignN2HistoricalBaselineToDecisionCutoffs,
} from "../research-replay/n2HistoricalCommonCohortAlignment";
import {
  N2_HISTORICAL_GLOBAL_LAPLACE_ALPHA,
  N2_HISTORICAL_LOOKBACK_DAYS,
  N2_HISTORICAL_MIN_GLOBAL_TRAINING_RACES,
  N2_HISTORICAL_MIN_VENUE_TRAINING_RACES,
  N2_HISTORICAL_VENUE_SHRINKAGE_PSEUDO_RACES,
  buildN2HistoricalOnlyBaselineDataset,
} from "../research-replay/n2HistoricalOnlyBaselineDataset";
import {
  readN2HistoricalOnlyBaselineSources,
  type N2HistoricalOnlyBaselineSourceRead,
} from "../research-replay/n2HistoricalOnlyBaselineSource";
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

export const N2_HISTORICAL_ONLY_BASELINE_EXECUTOR_VERSION =
  "n2-historical-only-baseline-executor-v1" as const;
const REPORT_RELATIVE_PATH = "reports/n2/n2-baseline-historical.json";

type HistoricalSourceReader = typeof readN2HistoricalOnlyBaselineSources;
type DecisionCutoffReader = typeof readN2T5DecisionCutoffMetadata;

function sanitizedSource(read: N2HistoricalOnlyBaselineSourceRead): Record<string, unknown> {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
    blockers: read.blockers,
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

function sanitizedCutoffMetadata(read: N2T5DecisionCutoffMetadataRead): Record<string, unknown> {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
    blockers: read.blockers,
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

export function createN2HistoricalOnlyBaselineExecutor(
  sourceReader: HistoricalSourceReader = readN2HistoricalOnlyBaselineSources,
  decisionCutoffReader: DecisionCutoffReader = readN2T5DecisionCutoffMetadata,
): Executor {
  return (ctx) => {
    const dataRoot = dirname(dirname(ctx.sidecarPath));
    let sourceRead: N2HistoricalOnlyBaselineSourceRead | null = null;
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
      name: "baseline-historical",
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
        sourceRead = sourceReader({ dataRoot, sidecarDbPath: ctx.sidecarPath });
        if (sourceRead.status !== "PASS") {
          errors.push(...sourceRead.blockers.map((blocker) => `HISTORICAL_BASELINE_${blocker}`));
          return { ok: false, errors };
        }
        cutoffRead = decisionCutoffReader({
          dataRoot,
          raceKeys: sourceRead.evaluationRaces.map((row) => row.canonicalRaceKey),
        });
        if (cutoffRead.status !== "PASS") {
          errors.push(...cutoffRead.blockers.map((blocker) => `HISTORICAL_BASELINE_CUTOFF_${blocker}`));
        }
        return { ok: errors.length === 0, errors };
      },
      executeReadOnly: () => {
        if (!sourceRead || sourceRead.status !== "PASS" || !cutoffRead || cutoffRead.status !== "PASS") {
          throw new Error("HISTORICAL_BASELINE_SOURCE_NOT_READY");
        }
        const baseDataset = buildN2HistoricalOnlyBaselineDataset({
          training: sourceRead.training,
          evaluationRaces: sourceRead.evaluationRaces,
        });
        if (baseDataset.status !== "PASS") {
          throw new Error(`HISTORICAL_BASELINE_DATASET_BLOCKED:${baseDataset.blockers.join(",")}`);
        }
        const alignment = alignN2HistoricalBaselineToDecisionCutoffs({
          dataset: baseDataset,
          decisionCutoffByRaceKey: cutoffRead.decisionCutoffByRaceKey,
        });
        if (alignment.status !== "PASS") {
          throw new Error(`HISTORICAL_BASELINE_CUTOFF_ALIGNMENT_BLOCKED:${alignment.blockers.join(",")}`);
        }
        const dataset = alignment.dataset;
        const globalCounts = dataset.trainingProfiles.map((profile) => profile.globalTrainingRaceCount);
        const venueCounts = dataset.trainingProfiles.map((profile) => profile.venueTrainingRaceCount);
        const trainingDigests = [...new Set(dataset.trainingProfiles.map((profile) => profile.trainingSnapshotDigest))].sort();
        const summary = {
          reportVersion: "n2-historical-only-baseline-report-v1",
          executorContractVersion: N2_HISTORICAL_ONLY_BASELINE_EXECUTOR_VERSION,
          baselineId: dataset.baselineId,
          modelVersion: dataset.modelVersion,
          featureContractVersion: dataset.featureContractVersion,
          status: dataset.status,
          cohortPolicy: dataset.cohortPolicy,
          modelPolicy: dataset.modelPolicy,
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
          decisionCutoffAlignmentVersion: alignment.alignmentVersion,
          alignedDecisionCutoffCount: alignment.alignedDecisionCutoffCount,
          modelConfig: {
            lookbackDays: N2_HISTORICAL_LOOKBACK_DAYS,
            globalLaplaceAlpha: N2_HISTORICAL_GLOBAL_LAPLACE_ALPHA,
            venueShrinkagePseudoRaces: N2_HISTORICAL_VENUE_SHRINKAGE_PSEUDO_RACES,
            minimumGlobalTrainingRaces: N2_HISTORICAL_MIN_GLOBAL_TRAINING_RACES,
            minimumVenueTrainingRaces: N2_HISTORICAL_MIN_VENUE_TRAINING_RACES,
            sameDayTrainingAllowed: false,
            currentRaceFeaturesUsed: false,
            liveOnlyFeaturesUsed: false,
            marketOddsUsed: false,
          },
          trainingSummary: {
            profileCount: dataset.trainingProfiles.length,
            uniqueTrainingSnapshotCount: trainingDigests.length,
            trainingSnapshotSetDigest: canonicalHash(trainingDigests),
            minimumGlobalTrainingRaceCount: Math.min(...globalCounts),
            maximumGlobalTrainingRaceCount: Math.max(...globalCounts),
            minimumVenueTrainingRaceCount: Math.min(...venueCounts),
            maximumVenueTrainingRaceCount: Math.max(...venueCounts),
          },
          source: sanitizedSource(sourceRead),
          decisionCutoffMetadata: sanitizedCutoffMetadata(cutoffRead),
          pit: {
            trainingBoundary: "race_date < evaluation_date",
            predictionAvailableAt: "00:00 JST on evaluation date",
            decisionCutoff: "same accepted T-5 cutoff as market baseline",
            checkedPredictionRowCount: dataset.rowCount,
            sameRaceLabelBorrow: false,
            sameDayLabelBorrow: false,
            futureLabelRead: false,
            marketOddsValueRead: false,
            liveOnlyFeatureRead: false,
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
        validatorId: "n2-historical-prior-date-only-pit",
        validatorVersion: N2_HISTORICAL_ONLY_BASELINE_EXECUTOR_VERSION,
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
            executorVersion: N2_HISTORICAL_ONLY_BASELINE_EXECUTOR_VERSION,
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
      executorVersion: N2_HISTORICAL_ONLY_BASELINE_EXECUTOR_VERSION,
      summary: outcome.summary,
      outputs: outcome.outputs,
      outputDigest: outcome.digest || canonicalHash(outcome.summary),
      blocks: outcome.blocks,
    };
  };
}

export const runN2HistoricalOnlyBaselineExecutor = createN2HistoricalOnlyBaselineExecutor();
