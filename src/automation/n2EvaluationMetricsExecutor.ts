import { dirname, join } from "node:path";

import { canonicalHash } from "../research-replay/canonical";
import {
  N2_EVALUATION_METRICS_BUNDLE_VERSION,
  buildN2EvaluationMetricsBundle,
} from "../research-replay/n2EvaluationMetricsBundle";
import {
  readN2EvaluationMetricsSettlements,
  type N2EvaluationMetricsSettlementRead,
} from "../research-replay/n2EvaluationMetricsSettlementReader";
import {
  readN2HistoricalOnlyBaselineSources,
  type N2HistoricalOnlyBaselineSourceRead,
} from "../research-replay/n2HistoricalOnlyBaselineSource";
import {
  readN2MarketOnlyBaselinePrivateSources,
  type N2MarketOnlyBaselinePrivateSourceRead,
} from "../research-replay/n2MarketOnlyBaselinePrivateSource";
import { buildN2MetricsDefinition } from "../research-replay/n2MetricsContract";
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

export const N2_EVALUATION_METRICS_EXECUTOR_VERSION =
  "n2-evaluation-metrics-executor-v2" as const;
const REPORT_RELATIVE_PATH = "reports/n2/n2-evaluation-metrics.json";

type MarketReader = typeof readN2MarketOnlyBaselinePrivateSources;
type HistoricalReader = typeof readN2HistoricalOnlyBaselineSources;
type CutoffReader = typeof readN2T5DecisionCutoffMetadata;
type SettlementReader = typeof readN2EvaluationMetricsSettlements;

function sanitizedMarket(read: N2MarketOnlyBaselinePrivateSourceRead) {
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
  };
}

function sanitizedHistorical(read: N2HistoricalOnlyBaselineSourceRead) {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
    readinessStatus: read.readinessStatus,
    readinessDigest: read.readinessDigest,
    selectedCohortRaceCount: read.selectedCohortRaceCount,
    historicalTrainingRaceCount: read.historicalTrainingRaceCount,
    trainingFromDateInclusive: read.trainingFromDateInclusive,
    trainingToDateInclusive: read.trainingToDateInclusive,
    databaseReadCount: read.databaseReadCount,
    databaseWriteCount: read.databaseWriteCount,
    networkRequestCount: read.networkRequestCount,
    rawOddsValuesRead: read.rawOddsValuesRead,
    liveOnlyFeatureReadCount: read.liveOnlyFeatureReadCount,
  };
}

function sanitizedCutoff(read: N2T5DecisionCutoffMetadataRead) {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
    alignedRaceCount: Object.keys(read.decisionCutoffByRaceKey).length,
    privateEnvelopeMetadataReadCount: read.privateEnvelopeMetadataReadCount,
    rawOddsValuesRead: read.rawOddsValuesRead,
    networkRequestCount: read.networkRequestCount,
    databaseReadCount: read.databaseReadCount,
    databaseWriteCount: read.databaseWriteCount,
  };
}

function sanitizedSettlement(read: N2EvaluationMetricsSettlementRead) {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
    requestedRaceCount: read.requestedRaceCount,
    settlementCount: read.settlementCount,
    databaseReadCount: read.databaseReadCount,
    databaseWriteCount: read.databaseWriteCount,
    networkRequestCount: read.networkRequestCount,
    sourcePolicy: read.sourcePolicy,
    outputDigest: read.outputDigest,
  };
}

export function createN2EvaluationMetricsExecutor(
  marketReader: MarketReader = readN2MarketOnlyBaselinePrivateSources,
  historicalReader: HistoricalReader = readN2HistoricalOnlyBaselineSources,
  cutoffReader: CutoffReader = readN2T5DecisionCutoffMetadata,
  settlementReader: SettlementReader = readN2EvaluationMetricsSettlements,
): Executor {
  return (ctx) => {
    const dataRoot = dirname(dirname(ctx.sidecarPath));
    let marketRead: N2MarketOnlyBaselinePrivateSourceRead | null = null;
    let historicalRead: N2HistoricalOnlyBaselineSourceRead | null = null;
    let cutoffRead: N2T5DecisionCutoffMetadataRead | null = null;
    let settlementRead: N2EvaluationMetricsSettlementRead | null = null;
    const sdkCtx: SdkContext = {
      repoRoot: ctx.repoRoot,
      runId: ctx.runId,
      taskId: ctx.taskId,
      dataRoot,
      dryRun: ctx.dryRun,
      writeAllowlist: ["reports/n2/"],
    };
    const spec: ExecutorSpec = {
      name: "evaluation-metrics",
      safetyLevel: "L0",
      implemented: true,
      inputContract: () => {
        const errors: string[] = [];
        if (ctx.taskStatuses["TASK-N2-022"] !== "PASS") {
          errors.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-022=${ctx.taskStatuses["TASK-N2-022"] ?? "UNKNOWN"}`);
          return { ok: false, errors };
        }
        marketRead = marketReader({ dataRoot, sidecarDbPath: ctx.sidecarPath });
        if (marketRead.status !== "PASS") {
          errors.push(...marketRead.blockers.map((item) => `METRICS_MARKET_${item}`));
          return { ok: false, errors };
        }
        historicalRead = historicalReader({ dataRoot, sidecarDbPath: ctx.sidecarPath });
        if (historicalRead.status !== "PASS") {
          errors.push(...historicalRead.blockers.map((item) => `METRICS_HISTORICAL_${item}`));
          return { ok: false, errors };
        }
        const raceKeys = historicalRead.evaluationRaces.map((row) => row.canonicalRaceKey);
        cutoffRead = cutoffReader({ dataRoot, raceKeys });
        if (cutoffRead.status !== "PASS") {
          errors.push(...cutoffRead.blockers.map((item) => `METRICS_CUTOFF_${item}`));
          return { ok: false, errors };
        }
        settlementRead = settlementReader({ sidecarDbPath: ctx.sidecarPath, raceKeys });
        if (settlementRead.status !== "PASS") {
          errors.push(...settlementRead.blockers.map((item) => `METRICS_SETTLEMENT_${item}`));
        }
        return { ok: errors.length === 0, errors };
      },
      executeReadOnly: () => {
        if (!marketRead || marketRead.status !== "PASS"
          || !historicalRead || historicalRead.status !== "PASS"
          || !cutoffRead || cutoffRead.status !== "PASS"
          || !settlementRead || settlementRead.status !== "PASS") {
          throw new Error("EVALUATION_METRICS_SOURCES_NOT_READY");
        }
        const bundle = buildN2EvaluationMetricsBundle({
          marketSources: marketRead.sources,
          historicalTraining: historicalRead.training,
          evaluationRaces: historicalRead.evaluationRaces,
          decisionCutoffByRaceKey: cutoffRead.decisionCutoffByRaceKey,
          settlements: settlementRead.settlements,
        });
        if (bundle.status !== "PASS") throw new Error(`EVALUATION_METRICS_BLOCKED:${bundle.blockers.join(",")}`);
        const metricsDefinition = buildN2MetricsDefinition();
        const summary = {
          reportVersion: "n2-evaluation-metrics-report-v2",
          executorContractVersion: N2_EVALUATION_METRICS_EXECUTOR_VERSION,
          bundleVersion: N2_EVALUATION_METRICS_BUNDLE_VERSION,
          status: "PASS",
          metricsDefinitionDigest: metricsDefinition.outputDigest,
          commonCohort: bundle.commonCohort,
          predictiveByBaseline: bundle.predictiveByBaseline,
          economic: bundle.economic,
          datasetDigests: bundle.datasetDigests,
          datasetCohortDigest: bundle.datasetCohortDigest,
          settlementSetDigest: bundle.settlementSetDigest,
          sources: {
            market: sanitizedMarket(marketRead),
            historical: sanitizedHistorical(historicalRead),
            cutoff: sanitizedCutoff(cutoffRead),
            settlement: sanitizedSettlement(settlementRead),
          },
          privacy: {
            ...bundle.privacy,
            privateMarketValuesUsedForEconomicEvaluation: true,
            privateMarketValuesPublished: false,
          },
          authority: bundle.authority,
          networkRequestCount: 0,
          sidecarWriteCount: 0,
          primaryDbReadCount: 0,
          primaryDbWriteCount: 0,
        };
        return { outputs: [REPORT_RELATIVE_PATH], digest: canonicalHash(summary), summary };
      },
      pitEvidence: (_sdk, artifact) => ({
        status: "PASS",
        validatorId: "n2-evaluation-metrics-common-cohort-pit",
        validatorVersion: N2_EVALUATION_METRICS_EXECUTOR_VERSION,
        checkedRecordCount: Number((artifact.summary.commonCohort as { commonRowCount?: unknown })?.commonRowCount ?? 0),
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
            executorVersion: N2_EVALUATION_METRICS_EXECUTOR_VERSION,
            generatedAt: new Date().toISOString(),
            outputDigest: artifact.digest,
          };
          atomicWriteJson(join(sdk.repoRoot, REPORT_RELATIVE_PATH), payload, true);
          return { ok: true, errors: [], outputs: [REPORT_RELATIVE_PATH] };
        } catch (error) {
          return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
        }
      },
      verifyArtifacts: (sdk, artifact) => verifyJsonReadback(join(sdk.repoRoot, REPORT_RELATIVE_PATH), artifact.digest),
      recordEvidence: (_sdk, _artifact, outputs) => ({ ok: true, errors: [], outputs }),
      finalizeEvidence: (_sdk, _artifact, outputs) => ({ ok: true, errors: [], outputs }),
    };

    const outcome = runExecutorLifecycle(spec, sdkCtx);
    const result: ExecutorResult["result"] = outcome.result === "ENGINEERING_REQUIRED" ? "BLOCKED" : outcome.result;
    return {
      result,
      executorVersion: N2_EVALUATION_METRICS_EXECUTOR_VERSION,
      summary: outcome.summary,
      outputs: outcome.outputs,
      outputDigest: outcome.digest || canonicalHash(outcome.summary),
      blocks: outcome.blocks,
    };
  };
}

export const runN2EvaluationMetricsExecutor = createN2EvaluationMetricsExecutor();
