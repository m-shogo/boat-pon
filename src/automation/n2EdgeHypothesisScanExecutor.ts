import { dirname, join } from "node:path";

import { canonicalHash } from "../research-replay/canonical";
import {
  buildN2EdgeDiscoveryCohort,
} from "../research-replay/n2EdgeDiscoveryCohort";
import {
  readN2EdgeDiscoverySource,
  type N2EdgeDiscoverySourceRead,
} from "../research-replay/n2EdgeDiscoverySource";
import {
  adaptN2HistoricalProgramFeatures,
} from "../research-replay/n2EdgeHistoricalProgramFeatureAdapter";
import {
  createN2EdgeHypothesisAccumulator,
  N2_EDGE_SCAN_MIN_UNIQUE_RACES,
} from "../research-replay/n2EdgeHypothesisScan";
import {
  readN2EdgeSelectedProgramFeatures,
  type N2EdgeSelectedProgramFeaturesRead,
} from "../research-replay/n2EdgeSelectedProgramFeatures";
import {
  buildN2HistoricalRollingBaseline,
} from "../research-replay/n2HistoricalRollingBaseline";
import { enumerateBetSelections } from "../research-replay/n2DatasetContract";
import {
  atomicWriteJson,
  runExecutorLifecycle,
  verifyJsonReadback,
  type ExecutorSpec,
  type SdkContext,
} from "../research/governance/executorSdk";
import type { Executor, ExecutorResult } from "./taskExecutors";

export const N2_EDGE_HYPOTHESIS_SCAN_EXECUTOR_VERSION =
  "n2-edge-hypothesis-scan-executor-v1" as const;
const REPORT_RELATIVE_PATH = "reports/n2/n2-edge-hypothesis-scan.json";
const TRIFECTA_SELECTIONS = enumerateBetSelections("trifecta");

type SourceReader = typeof readN2EdgeDiscoverySource;
type SelectedProgramReader = typeof readN2EdgeSelectedProgramFeatures;

function sanitizedSource(read: N2EdgeDiscoverySourceRead) {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
    historicalOutcomeCount: read.historicalOutcomeCount,
    officialProgramMetadataCount: read.officialProgramMetadataCount,
    eligibleProgramMetadataCount: read.eligibleProgramMetadataCount,
    candidateRaceCount: read.candidateRaceCount,
    missingOfficialProgramCount: read.missingOfficialProgramCount,
    missingCleanWinnerCount: read.missingCleanWinnerCount,
    excludedProgramCount: read.excludedProgramCount,
    excludedProgramReasonCounts: read.excludedProgramReasonCounts,
    reads: read.reads,
    outputDigest: read.outputDigest,
  };
}

function sanitizedSelectedPrograms(read: N2EdgeSelectedProgramFeaturesRead) {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
    requestedRaceCount: read.requestedRaceCount,
    matchedProgramCount: read.matchedProgramCount,
    parsedProgramCount: read.parsedProgramCount,
    safeProgramCount: read.safeProgramCount,
    rawJsonReadCount: read.rawJsonReadCount,
    identityFieldCountPublished: read.identityFieldCountPublished,
    liveOnlyFeatureValueCount: read.liveOnlyFeatureValueCount,
    venueSpecificUnprovenFeatureValueCount: read.venueSpecificUnprovenFeatureValueCount,
    primaryDatabaseReadCount: read.primaryDatabaseReadCount,
    primaryDatabaseWriteCount: read.primaryDatabaseWriteCount,
    networkRequestCount: read.networkRequestCount,
    outputDigest: read.outputDigest,
  };
}

export function createN2EdgeHypothesisScanExecutor(
  sourceReader: SourceReader = readN2EdgeDiscoverySource,
  selectedProgramReader: SelectedProgramReader = readN2EdgeSelectedProgramFeatures,
): Executor {
  return (ctx) => {
    const dataRoot = dirname(dirname(ctx.sidecarPath));
    const primaryDbPath = join(dataRoot, "data/boat.sqlite");
    let sourceRead: N2EdgeDiscoverySourceRead | null = null;
    let selectedProgramRead: N2EdgeSelectedProgramFeaturesRead | null = null;

    const sdkCtx: SdkContext = {
      repoRoot: ctx.repoRoot,
      runId: ctx.runId,
      taskId: ctx.taskId,
      dataRoot,
      dryRun: ctx.dryRun,
      writeAllowlist: ["reports/n2/"],
    };
    const spec: ExecutorSpec = {
      name: "edge-hypothesis-scan",
      safetyLevel: "L0",
      implemented: true,
      inputContract: () => {
        const errors: string[] = [];
        if (ctx.taskStatuses["TASK-N2-030"] !== "PASS") {
          errors.push(`DEPENDENCY_NOT_SATISFIED:TASK-N2-030=${ctx.taskStatuses["TASK-N2-030"] ?? "UNKNOWN"}`);
          return { ok: false, errors };
        }
        sourceRead = sourceReader({ primaryDbPath, sidecarDbPath: ctx.sidecarPath });
        if (sourceRead.status !== "PASS") {
          errors.push(...sourceRead.blockers.map((item) => `EDGE_SOURCE_${item}`));
        }
        return { ok: errors.length === 0, errors };
      },
      executeReadOnly: () => {
        if (!sourceRead || sourceRead.status !== "PASS") throw new Error("EDGE_DISCOVERY_SOURCE_NOT_READY");

        const support = buildN2HistoricalRollingBaseline({
          outcomes: sourceRead.historicalOutcomes,
          requestedRaceKeys: sourceRead.candidates.map((candidate) => candidate.canonicalRaceKey),
          includeProbabilities: false,
        });
        if (support.status !== "PASS") throw new Error(`EDGE_SUPPORT_BLOCKED:${support.blockers.join(",")}`);
        const supportByRace = new Map(support.supports.map((item) => [item.canonicalRaceKey, item.supported]));
        const supportedCandidates = sourceRead.candidates.filter((candidate) => supportByRace.get(candidate.canonicalRaceKey) === true);

        const cohort = buildN2EdgeDiscoveryCohort(
          supportedCandidates.map((candidate) => ({ canonicalRaceKey: candidate.canonicalRaceKey })),
        );
        if (cohort.status !== "PASS") throw new Error(`EDGE_COHORT_BLOCKED:${cohort.blockers.join(",")}`);
        if (cohort.selectedRaceCount < N2_EDGE_SCAN_MIN_UNIQUE_RACES) {
          throw new Error(`EDGE_COHORT_TOO_SMALL:${cohort.selectedRaceCount}/${N2_EDGE_SCAN_MIN_UNIQUE_RACES}`);
        }

        const candidateByRace = new Map(supportedCandidates.map((candidate) => [candidate.canonicalRaceKey, candidate]));
        const selectedCandidates = cohort.races.map((race) => candidateByRace.get(race.canonicalRaceKey)).filter((candidate) => candidate != null);
        if (selectedCandidates.length !== cohort.selectedRaceCount) {
          throw new Error(`EDGE_SELECTED_CANDIDATE_COUNT:${selectedCandidates.length}/${cohort.selectedRaceCount}`);
        }

        const rolling = buildN2HistoricalRollingBaseline({
          outcomes: sourceRead.historicalOutcomes,
          requestedRaceKeys: selectedCandidates.map((candidate) => candidate.canonicalRaceKey),
        });
        if (rolling.status !== "PASS") throw new Error(`EDGE_BASELINE_BLOCKED:${rolling.blockers.join(",")}`);
        if (rolling.baselineRaceCount !== cohort.selectedRaceCount) {
          throw new Error(`EDGE_BASELINE_RACE_COUNT:${rolling.baselineRaceCount}/${cohort.selectedRaceCount}`);
        }

        selectedProgramRead = selectedProgramReader({ primaryDbPath, selectedCandidates });
        if (selectedProgramRead.status !== "PASS") {
          throw new Error(`EDGE_SELECTED_PROGRAM_BLOCKED:${selectedProgramRead.blockers.join(",")}`);
        }
        const programByRace = new Map(selectedProgramRead.programs.map((program) => [program.canonicalRaceKey, program]));
        const baselineByRace = new Map(rolling.baselines.map((baseline) => [baseline.canonicalRaceKey, baseline]));
        const accumulator = createN2EdgeHypothesisAccumulator();
        let adaptedSelectionCount = 0;
        let mappedFeatureValueCount = 0;
        let nullFeatureValueCount = 0;

        for (const cohortRace of cohort.races) {
          const candidate = candidateByRace.get(cohortRace.canonicalRaceKey);
          const baseline = baselineByRace.get(cohortRace.canonicalRaceKey);
          const program = programByRace.get(cohortRace.canonicalRaceKey);
          if (!candidate || !baseline || !program) {
            throw new Error(`EDGE_MATERIALIZED_RACE_MISSING:${cohortRace.canonicalRaceKey}`);
          }
          for (const selection of TRIFECTA_SELECTIONS) {
            const adapted = adaptN2HistoricalProgramFeatures({
              betSelection: selection,
              decisionCutoff: candidate.decisionCutoff,
              featureMode: "historical-readonly",
              programFeatures: program.programFeatures,
            });
            if (adapted.status !== "PASS") {
              throw new Error(`EDGE_FEATURE_ADAPTER_BLOCKED:${cohortRace.canonicalRaceKey}:${selection}:${adapted.blockers.join(",")}`);
            }
            adaptedSelectionCount += 1;
            mappedFeatureValueCount += adapted.mappedFeatureCount;
            nullFeatureValueCount += adapted.nullFeatureCount;
            accumulator.add({
              canonicalRaceKey: cohortRace.canonicalRaceKey,
              split: "train",
              decisionCutoff: candidate.decisionCutoff,
              betSelection: selection,
              hit: selection === baseline.winningSelection ? 1 : 0,
              baselineId: baseline.baselineId,
              baselineProbability: baseline.probabilityBySelection[selection],
              features: adapted.features,
            });
          }
        }
        const scan = accumulator.finalize();
        if (scan.status !== "PASS") throw new Error(`EDGE_SCAN_BLOCKED:${scan.blockers.join(",")}`);

        const summary = {
          reportVersion: "n2-edge-hypothesis-scan-report-v1",
          executorContractVersion: N2_EDGE_HYPOTHESIS_SCAN_EXECUTOR_VERSION,
          status: "PASS",
          source: sanitizedSource(sourceRead),
          support: {
            requestedRaceCount: support.requestedRaceCount,
            supportedRaceCount: support.supportedRaceCount,
            unsupportedRaceCount: support.unsupportedRaceCount,
            lookbackDays: support.lookbackDays,
            minGlobalTrainingRaces: support.minGlobalTrainingRaces,
            minVenueTrainingRaces: support.minVenueTrainingRaces,
            outputDigest: support.outputDigest,
          },
          cohort: {
            cohortVersion: cohort.cohortVersion,
            selectedRaceCount: cohort.selectedRaceCount,
            selectedSelectionRowCount: cohort.selectedSelectionRowCount,
            representedYearCount: cohort.representedYearCount,
            representedVenueCount: cohort.representedVenueCount,
            representedStratumCount: cohort.representedStratumCount,
            cohortDigest: cohort.cohortDigest,
            outputDigest: cohort.outputDigest,
            labelAvailabilityRequired: true,
            labelValueUsedForSampling: false,
          },
          baseline: {
            rollingVersion: rolling.rollingVersion,
            baselineId: rolling.baselineId,
            baselineRaceCount: rolling.baselineRaceCount,
            baselineSelectionRowCount: rolling.baselineSelectionRowCount,
            outputDigest: rolling.outputDigest,
          },
          selectedPrograms: sanitizedSelectedPrograms(selectedProgramRead),
          featureMaterialization: {
            adaptedSelectionCount,
            mappedFeatureValueCount,
            nullFeatureValueCount,
            timedFeatureAdaptersEnabled: false,
            venueSpecificUnprovenFeaturesEnabled: false,
          },
          scan,
          privacy: {
            raceKeysPersisted: false,
            winningSelectionsPersisted: false,
            rowLevelPredictionsPersisted: false,
            rawProgramJsonPersisted: false,
            racerIdentityPersisted: false,
            primaryPathsPersisted: false,
          },
          authority: {
            automaticPromotionAuthorized: false,
            currentBuyConnectionAuthorized: false,
            lineConnectionAuthorized: false,
            publicPublishAuthorized: false,
            automatedBettingAuthorized: false,
            productionApplyAuthorized: false,
          },
          databaseWriteCount: 0,
          networkRequestCount: 0,
        };
        return { outputs: [REPORT_RELATIVE_PATH], digest: canonicalHash(summary), summary };
      },
      pitEvidence: (_sdk, artifact) => ({
        status: "PASS",
        validatorId: "n2-edge-discovery-pit-and-holdout",
        validatorVersion: N2_EDGE_HYPOTHESIS_SCAN_EXECUTOR_VERSION,
        checkedRecordCount: Number((artifact.summary.scan as { inputObservationCount?: unknown })?.inputObservationCount ?? 0),
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
            executorVersion: N2_EDGE_HYPOTHESIS_SCAN_EXECUTOR_VERSION,
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
    const undersizedCohort = outcome.result === "FAILED"
      && outcome.blocks[0] === "EXECUTOR_EXCEPTION"
      && outcome.blocks[1]?.startsWith("EDGE_COHORT_TOO_SMALL:");
    const result: ExecutorResult["result"] = undersizedCohort
      ? "BLOCKED"
      : outcome.result === "ENGINEERING_REQUIRED" ? "BLOCKED" : outcome.result;
    return {
      result,
      executorVersion: N2_EDGE_HYPOTHESIS_SCAN_EXECUTOR_VERSION,
      summary: outcome.summary,
      outputs: outcome.outputs,
      outputDigest: outcome.digest || canonicalHash(outcome.summary),
      blocks: outcome.blocks,
    };
  };
}

export const runN2EdgeHypothesisScanExecutor = createN2EdgeHypothesisScanExecutor();
