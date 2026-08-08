import {
  compareN2BaselinesOnCommonCohort,
  type N2BaselineMetrics,
} from "./n2BaselineEvaluation";
import { canonicalHash } from "./canonical";
import {
  alignN2HistoricalBaselineToDecisionCutoffs,
} from "./n2HistoricalCommonCohortAlignment";
import {
  buildN2HistoricalOnlyBaselineDataset,
  type N2HistoricalEvaluationRace,
  type N2HistoricalOutcomeRow,
} from "./n2HistoricalOnlyBaselineDataset";
import {
  buildN2LegacyBaselineDataset,
} from "./n2LegacyBaselineDataset";
import {
  buildN2MarketOnlyBaselineDataset,
  type N2MarketOnlyBaselineRaceSource,
} from "./n2MarketOnlyBaselineDataset";

export const N2_COMMON_COHORT_EVALUATION_VERSION =
  "n2-common-cohort-evaluation-v1" as const;
export const N2_COMMON_COHORT_REQUIRED_ROWS = 2400;
export const N2_COMMON_COHORT_REQUIRED_BASELINES = 3;

export type N2CommonCohortEvaluation = {
  evaluationVersion: typeof N2_COMMON_COHORT_EVALUATION_VERSION;
  status: "COMPARABLE" | "BLOCKED";
  blockers: string[];
  requiredBaselineCount: number;
  requiredCommonRowCount: number;
  baselineIds: string[];
  baselineKinds: string[];
  baselineInputRowCounts: Record<string, number>;
  commonRowCount: number;
  commonPositiveCount: number;
  excludedOutsideCommonCohort: Record<string, number>;
  baselineMetrics: Record<string, N2BaselineMetrics>;
  commonCohortDigest: string;
  comparisonDigest: string;
  marketDatasetDigest: string;
  historicalDatasetDigest: string;
  legacyDatasetDigest: string;
  outputDigest: string;
};

function blocked(input: {
  blockers: string[];
  marketDatasetDigest?: string;
  historicalDatasetDigest?: string;
  legacyDatasetDigest?: string;
}): N2CommonCohortEvaluation {
  const normalizedBlockers = [...new Set(input.blockers)].sort();
  const core = {
    evaluationVersion: N2_COMMON_COHORT_EVALUATION_VERSION,
    status: "BLOCKED" as const,
    blockers: normalizedBlockers,
    requiredBaselineCount: N2_COMMON_COHORT_REQUIRED_BASELINES,
    requiredCommonRowCount: N2_COMMON_COHORT_REQUIRED_ROWS,
    baselineIds: [] as string[],
    baselineKinds: [] as string[],
    baselineInputRowCounts: {} as Record<string, number>,
    commonRowCount: 0,
    commonPositiveCount: 0,
    excludedOutsideCommonCohort: {} as Record<string, number>,
    baselineMetrics: {} as Record<string, N2BaselineMetrics>,
    commonCohortDigest: canonicalHash([]),
    comparisonDigest: canonicalHash({ status: "BLOCKED", blockers: normalizedBlockers }),
    marketDatasetDigest: input.marketDatasetDigest ?? canonicalHash("market-not-built"),
    historicalDatasetDigest: input.historicalDatasetDigest ?? canonicalHash("historical-not-built"),
    legacyDatasetDigest: input.legacyDatasetDigest ?? canonicalHash("legacy-not-built"),
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function evaluateN2CommonCohort(input: {
  marketSources: N2MarketOnlyBaselineRaceSource[];
  historicalTraining: N2HistoricalOutcomeRow[];
  evaluationRaces: N2HistoricalEvaluationRace[];
  decisionCutoffByRaceKey: Readonly<Record<string, string>>;
}): N2CommonCohortEvaluation {
  const market = buildN2MarketOnlyBaselineDataset({ sources: input.marketSources });
  if (market.status !== "PASS") {
    return blocked({
      blockers: market.blockers.map((blocker) => `MARKET:${blocker}`),
      marketDatasetDigest: market.outputDigest,
    });
  }

  const historicalBase = buildN2HistoricalOnlyBaselineDataset({
    training: input.historicalTraining,
    evaluationRaces: input.evaluationRaces,
  });
  if (historicalBase.status !== "PASS") {
    return blocked({
      blockers: historicalBase.blockers.map((blocker) => `HISTORICAL:${blocker}`),
      marketDatasetDigest: market.outputDigest,
      historicalDatasetDigest: historicalBase.outputDigest,
    });
  }
  const historicalAlignment = alignN2HistoricalBaselineToDecisionCutoffs({
    dataset: historicalBase,
    decisionCutoffByRaceKey: input.decisionCutoffByRaceKey,
  });
  if (historicalAlignment.status !== "PASS") {
    return blocked({
      blockers: historicalAlignment.blockers.map((blocker) => `HISTORICAL_ALIGNMENT:${blocker}`),
      marketDatasetDigest: market.outputDigest,
      historicalDatasetDigest: historicalAlignment.dataset.outputDigest,
    });
  }
  const historical = historicalAlignment.dataset;

  const legacy = buildN2LegacyBaselineDataset({
    training: input.historicalTraining,
    evaluationRaces: input.evaluationRaces,
    decisionCutoffByRaceKey: input.decisionCutoffByRaceKey,
  });
  if (legacy.status !== "PASS") {
    return blocked({
      blockers: legacy.blockers.map((blocker) => `LEGACY:${blocker}`),
      marketDatasetDigest: market.outputDigest,
      historicalDatasetDigest: historical.outputDigest,
      legacyDatasetDigest: legacy.outputDigest,
    });
  }

  if (market.cohortDigest !== historical.cohortDigest || market.cohortDigest !== legacy.cohortDigest) {
    return blocked({
      blockers: ["COHORT_DIGEST_MISMATCH"],
      marketDatasetDigest: market.outputDigest,
      historicalDatasetDigest: historical.outputDigest,
      legacyDatasetDigest: legacy.outputDigest,
    });
  }

  const comparison = compareN2BaselinesOnCommonCohort({
    baselines: {
      [market.baselineId]: market.rows,
      [historical.baselineId]: historical.rows,
      [legacy.baselineId]: legacy.rows,
    },
    minimumCommonRows: N2_COMMON_COHORT_REQUIRED_ROWS,
  });
  const comparisonBlockers: string[] = [];
  if (comparison.status !== "COMPARABLE") comparisonBlockers.push(`COMPARISON_STATUS:${comparison.status}`);
  if (comparison.baselineIds.length !== N2_COMMON_COHORT_REQUIRED_BASELINES) {
    comparisonBlockers.push(`BASELINE_COUNT:${comparison.baselineIds.length}/${N2_COMMON_COHORT_REQUIRED_BASELINES}`);
  }
  if (comparison.commonRowCount !== N2_COMMON_COHORT_REQUIRED_ROWS) {
    comparisonBlockers.push(`COMMON_ROW_COUNT:${comparison.commonRowCount}/${N2_COMMON_COHORT_REQUIRED_ROWS}`);
  }
  if (comparison.conflicts.length > 0) {
    comparisonBlockers.push(...comparison.conflicts.map((conflict) => `CONFLICT:${conflict}`));
  }
  if (comparisonBlockers.length > 0) {
    return blocked({
      blockers: comparisonBlockers,
      marketDatasetDigest: market.outputDigest,
      historicalDatasetDigest: historical.outputDigest,
      legacyDatasetDigest: legacy.outputDigest,
    });
  }

  const baselineKinds = ["market_only", "historical_only", "legacy"];
  const baselineMetrics = Object.fromEntries(
    comparison.baselineIds.map((baselineId) => [baselineId, comparison.reports[baselineId].metrics]),
  ) as Record<string, N2BaselineMetrics>;
  const commonPositiveCounts = comparison.baselineIds.map(
    (baselineId) => comparison.reports[baselineId].metrics.positiveCount,
  );
  if (new Set(commonPositiveCounts).size !== 1) {
    return blocked({
      blockers: [`COMMON_POSITIVE_COUNT_MISMATCH:${commonPositiveCounts.join(",")}`],
      marketDatasetDigest: market.outputDigest,
      historicalDatasetDigest: historical.outputDigest,
      legacyDatasetDigest: legacy.outputDigest,
    });
  }

  const core = {
    evaluationVersion: N2_COMMON_COHORT_EVALUATION_VERSION,
    status: "COMPARABLE" as const,
    blockers: [] as string[],
    requiredBaselineCount: N2_COMMON_COHORT_REQUIRED_BASELINES,
    requiredCommonRowCount: N2_COMMON_COHORT_REQUIRED_ROWS,
    baselineIds: comparison.baselineIds,
    baselineKinds,
    baselineInputRowCounts: comparison.inputCounts,
    commonRowCount: comparison.commonRowCount,
    commonPositiveCount: commonPositiveCounts[0] ?? 0,
    excludedOutsideCommonCohort: comparison.excludedOutsideCommonCohort,
    baselineMetrics,
    commonCohortDigest: comparison.commonCohortDigest,
    comparisonDigest: comparison.outputDigest,
    marketDatasetDigest: market.outputDigest,
    historicalDatasetDigest: historical.outputDigest,
    legacyDatasetDigest: legacy.outputDigest,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
