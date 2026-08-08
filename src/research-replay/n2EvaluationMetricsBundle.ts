import { canonicalHash } from "./canonical";
import {
  evaluateN2CommonCohort,
  type N2CommonCohortEvaluation,
} from "./n2CommonCohortEvaluation";
import {
  evaluateN2EconomicMetrics,
  type N2EconomicEvaluationRace,
  type N2EconomicMetricsEvaluation,
} from "./n2EconomicMetricsEvaluation";
import type { N2EvaluationSettlement } from "./n2EvaluationMetricsSettlementReader";
import {
  alignN2HistoricalBaselineToDecisionCutoffs,
} from "./n2HistoricalCommonCohortAlignment";
import {
  buildN2HistoricalOnlyBaselineDataset,
  type N2HistoricalEvaluationRace,
  type N2HistoricalOutcomeRow,
} from "./n2HistoricalOnlyBaselineDataset";
import { buildN2LegacyBaselineDataset } from "./n2LegacyBaselineDataset";
import {
  buildN2MarketOnlyBaselineDataset,
  type N2MarketOnlyBaselineRaceSource,
} from "./n2MarketOnlyBaselineDataset";
import type { N2BaselinePredictionRow } from "./n2BaselineEvaluation";

export const N2_EVALUATION_METRICS_BUNDLE_VERSION =
  "n2-evaluation-metrics-bundle-v1" as const;

export type N2EvaluationMetricsBundle = {
  bundleVersion: typeof N2_EVALUATION_METRICS_BUNDLE_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  commonCohort: {
    status: N2CommonCohortEvaluation["status"];
    baselineIds: string[];
    baselineKinds: string[];
    commonRowCount: number;
    commonPositiveCount: number;
    commonCohortDigest: string;
    comparisonDigest: string;
  };
  predictiveByBaseline: N2CommonCohortEvaluation["baselineMetrics"];
  economic: N2EconomicMetricsEvaluation;
  datasetDigests: {
    market: string;
    historical: string;
    legacy: string;
  };
  settlementSetDigest: string;
  privacy: {
    rowLevelPredictionsPersisted: false;
    rawMarketOddsPersisted: false;
    winningSelectionsPersisted: false;
    payoutsByRacePersisted: false;
    raceKeysPersisted: false;
  };
  authority: {
    automaticPromotionAuthorized: false;
    currentBuyConnectionAuthorized: false;
    lineConnectionAuthorized: false;
    publicPublishAuthorized: false;
    automatedBettingAuthorized: false;
    productionApplyAuthorized: false;
  };
  outputDigest: string;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function blocked(blockers: string[]): N2EvaluationMetricsBundle {
  const normalized = unique(blockers);
  const emptyEconomic = evaluateN2EconomicMetrics({ races: [] });
  const core = {
    bundleVersion: N2_EVALUATION_METRICS_BUNDLE_VERSION,
    status: "BLOCKED" as const,
    blockers: normalized,
    commonCohort: {
      status: "BLOCKED" as const,
      baselineIds: [] as string[],
      baselineKinds: [] as string[],
      commonRowCount: 0,
      commonPositiveCount: 0,
      commonCohortDigest: canonicalHash([]),
      comparisonDigest: canonicalHash({ blockers: normalized }),
    },
    predictiveByBaseline: {} as N2CommonCohortEvaluation["baselineMetrics"],
    economic: emptyEconomic,
    datasetDigests: {
      market: canonicalHash("market-not-built"),
      historical: canonicalHash("historical-not-built"),
      legacy: canonicalHash("legacy-not-built"),
    },
    settlementSetDigest: canonicalHash([]),
    privacy: {
      rowLevelPredictionsPersisted: false as const,
      rawMarketOddsPersisted: false as const,
      winningSelectionsPersisted: false as const,
      payoutsByRacePersisted: false as const,
      raceKeysPersisted: false as const,
    },
    authority: {
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function rowsToProbabilityMap(rows: N2BaselinePredictionRow[]): Map<string, Record<string, number>> {
  const byRace = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const current = byRace.get(row.canonicalRaceKey) ?? {};
    current[row.betSelection] = row.probability;
    byRace.set(row.canonicalRaceKey, current);
  }
  return byRace;
}

export function buildN2EvaluationMetricsBundle(input: {
  marketSources: N2MarketOnlyBaselineRaceSource[];
  historicalTraining: N2HistoricalOutcomeRow[];
  evaluationRaces: N2HistoricalEvaluationRace[];
  decisionCutoffByRaceKey: Readonly<Record<string, string>>;
  settlements: N2EvaluationSettlement[];
}): N2EvaluationMetricsBundle {
  const common = evaluateN2CommonCohort({
    marketSources: input.marketSources,
    historicalTraining: input.historicalTraining,
    evaluationRaces: input.evaluationRaces,
    decisionCutoffByRaceKey: input.decisionCutoffByRaceKey,
  });
  if (common.status !== "COMPARABLE") {
    return blocked(common.blockers.map((item) => `COMMON:${item}`));
  }

  const market = buildN2MarketOnlyBaselineDataset({ sources: input.marketSources });
  const historicalBase = buildN2HistoricalOnlyBaselineDataset({
    training: input.historicalTraining,
    evaluationRaces: input.evaluationRaces,
  });
  if (market.status !== "PASS") return blocked(market.blockers.map((item) => `MARKET:${item}`));
  if (historicalBase.status !== "PASS") return blocked(historicalBase.blockers.map((item) => `HISTORICAL:${item}`));
  const historicalAlignment = alignN2HistoricalBaselineToDecisionCutoffs({
    dataset: historicalBase,
    decisionCutoffByRaceKey: input.decisionCutoffByRaceKey,
  });
  if (historicalAlignment.status !== "PASS") {
    return blocked(historicalAlignment.blockers.map((item) => `HISTORICAL_ALIGNMENT:${item}`));
  }
  const historical = historicalAlignment.dataset;
  const legacy = buildN2LegacyBaselineDataset({
    training: input.historicalTraining,
    evaluationRaces: input.evaluationRaces,
    decisionCutoffByRaceKey: input.decisionCutoffByRaceKey,
  });
  if (legacy.status !== "PASS") return blocked(legacy.blockers.map((item) => `LEGACY:${item}`));

  const digestBlockers: string[] = [];
  if (market.outputDigest !== common.marketDatasetDigest) digestBlockers.push("MARKET_DATASET_DIGEST_MISMATCH");
  if (historical.outputDigest !== common.historicalDatasetDigest) digestBlockers.push("HISTORICAL_DATASET_DIGEST_MISMATCH");
  if (legacy.outputDigest !== common.legacyDatasetDigest) digestBlockers.push("LEGACY_DATASET_DIGEST_MISMATCH");
  if (market.cohortDigest !== common.commonCohortDigest
    || historical.cohortDigest !== common.commonCohortDigest
    || legacy.cohortDigest !== common.commonCohortDigest) digestBlockers.push("COHORT_DIGEST_MISMATCH");
  if (digestBlockers.length > 0) return blocked(digestBlockers);

  const settlementByRace = new Map(input.settlements.map((row) => [row.canonicalRaceKey, row]));
  const marketSourceByRace = new Map(input.marketSources.map((row) => [row.canonicalRaceKey, row]));
  const evaluationByRace = new Map(input.evaluationRaces.map((row) => [row.canonicalRaceKey, row]));
  const probabilityMaps = {
    [market.baselineId]: rowsToProbabilityMap(market.rows),
    [historical.baselineId]: rowsToProbabilityMap(historical.rows),
    [legacy.baselineId]: rowsToProbabilityMap(legacy.rows),
  };

  const blockers: string[] = [];
  const economicRaces: N2EconomicEvaluationRace[] = [];
  const cohortRaceKeys = [...marketSourceByRace.keys()].sort();
  for (const canonicalRaceKey of cohortRaceKeys) {
    const source = marketSourceByRace.get(canonicalRaceKey);
    const settlement = settlementByRace.get(canonicalRaceKey);
    const evaluation = evaluationByRace.get(canonicalRaceKey);
    const decisionCutoff = input.decisionCutoffByRaceKey[canonicalRaceKey];
    if (!source) blockers.push(`${canonicalRaceKey}:MARKET_SOURCE_MISSING`);
    if (!settlement) blockers.push(`${canonicalRaceKey}:SETTLEMENT_MISSING`);
    if (!evaluation) blockers.push(`${canonicalRaceKey}:EVALUATION_LABEL_MISSING`);
    if (typeof decisionCutoff !== "string") blockers.push(`${canonicalRaceKey}:DECISION_CUTOFF_MISSING`);
    if (!source || !settlement || !evaluation || typeof decisionCutoff !== "string") continue;
    if (source.winningSelection !== settlement.winningSelection
      || evaluation.winningSelection !== settlement.winningSelection) {
      blockers.push(`${canonicalRaceKey}:WINNING_SELECTION_CONFLICT`);
      continue;
    }
    const probabilityByBaseline: Record<string, Record<string, number>> = {};
    for (const baselineId of common.baselineIds) {
      const map = probabilityMaps[baselineId]?.get(canonicalRaceKey);
      if (!map) blockers.push(`${canonicalRaceKey}:${baselineId}:PROBABILITY_MAP_MISSING`);
      else probabilityByBaseline[baselineId] = map;
    }
    if (Object.keys(probabilityByBaseline).length !== common.baselineIds.length) continue;
    economicRaces.push({
      canonicalRaceKey,
      decisionCutoff,
      winningSelection: settlement.winningSelection,
      payoutYen: settlement.payoutYen,
      marketOddsBySelection: Object.fromEntries(source.selections.map((row) => [row.selection, row.odds])),
      probabilityByBaseline,
    });
  }
  if (input.settlements.length !== cohortRaceKeys.length) blockers.push(`SETTLEMENT_COUNT:${input.settlements.length}/${cohortRaceKeys.length}`);
  if (blockers.length > 0) return blocked(blockers);

  const economic = evaluateN2EconomicMetrics({ races: economicRaces });
  if (economic.status !== "PASS") return blocked(economic.blockers.map((item) => `ECONOMIC:${item}`));

  const settlementSetDigest = canonicalHash(
    [...input.settlements]
      .sort((left, right) => left.canonicalRaceKey.localeCompare(right.canonicalRaceKey)),
  );
  const core = {
    bundleVersion: N2_EVALUATION_METRICS_BUNDLE_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    commonCohort: {
      status: common.status,
      baselineIds: common.baselineIds,
      baselineKinds: common.baselineKinds,
      commonRowCount: common.commonRowCount,
      commonPositiveCount: common.commonPositiveCount,
      commonCohortDigest: common.commonCohortDigest,
      comparisonDigest: common.comparisonDigest,
    },
    predictiveByBaseline: common.baselineMetrics,
    economic,
    datasetDigests: {
      market: market.outputDigest,
      historical: historical.outputDigest,
      legacy: legacy.outputDigest,
    },
    settlementSetDigest,
    privacy: {
      rowLevelPredictionsPersisted: false as const,
      rawMarketOddsPersisted: false as const,
      winningSelectionsPersisted: false as const,
      payoutsByRacePersisted: false as const,
      raceKeysPersisted: false as const,
    },
    authority: {
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
