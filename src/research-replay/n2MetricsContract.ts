import { canonicalHash } from "./canonical";

export const N2_METRICS_CONTRACT_VERSION = "n2-metrics-contract-v1" as const;
export const N2_METRICS_REQUIRED_BASELINE_COUNT = 3;
export const N2_METRICS_REQUIRED_RACE_COUNT = 20;
export const N2_METRICS_SELECTIONS_PER_RACE = 120;
export const N2_METRICS_REQUIRED_COMMON_ROWS =
  N2_METRICS_REQUIRED_RACE_COUNT * N2_METRICS_SELECTIONS_PER_RACE;
export const N2_METRICS_FIXED_STAKE_YEN = 100;
export const N2_METRICS_POSITIVE_EV_THRESHOLD = 1;
export const N2_METRICS_EV_EPSILON = 1e-12;
export const N2_METRICS_CALIBRATION_BIN_COUNT = 10;

export type N2EconomicPolicyId = "forced_top1" | "positive_ev_top1";

export type N2MetricsDefinition = {
  contractVersion: typeof N2_METRICS_CONTRACT_VERSION;
  status: "FROZEN";
  commonCohort: {
    requiredBaselineCount: number;
    requiredRaceCount: number;
    selectionsPerRace: number;
    requiredPredictionRowCount: number;
    exactRowIdentityRequired: true;
    exactLabelMatchRequired: true;
    exactDecisionCutoffMatchRequired: true;
    predictionCoverageFormula: "valid_common_prediction_rows / required_prediction_rows";
    requiredPredictionCoverage: 1;
  };
  predictiveMetrics: {
    canonicalEvaluator: "evaluateN2Baseline";
    primary: ["meanLogLoss", "calibrationEce"];
    diagnostics: ["meanBrier", "calibrationBins", "positiveCount", "rowCount"];
    logLossUnit: "binary_row_mean";
    calibrationBinCount: number;
    comparisonDirection: {
      meanLogLoss: "lower_is_better";
      calibrationEce: "lower_is_better";
      meanBrier: "lower_is_better";
    };
  };
  economicEvaluation: {
    stakeYenPerTicket: number;
    officialPayoutUnitStakeYen: 100;
    settlementSource: "clean_normal_resolved_trifecta_payout";
    executionMarketSource: "accepted_private_T-5_market_only";
    taxesAndFees: "excluded";
    policies: Array<{
      policyId: N2EconomicPolicyId;
      selectionRule: string;
      marketOddsUsedForSelection: boolean;
      betCondition: string;
      tieBreak: "selection_lexicographic_ascending";
      maxTicketsPerRace: 1;
    }>;
    betCoverageFormula: "bet_race_count / evaluable_race_count";
    returnRatePctFormula: "total_return_yen / total_stake_yen * 100";
    returnRateBreakEvenPct: 100;
    netRoiPctFormula: "(total_return_yen - total_stake_yen) / total_stake_yen * 100";
    netRoiBreakEvenPct: 0;
    zeroStakeRoi: null;
    maxDrawdownFormula: "max(running_peak_net_profit_yen - cumulative_net_profit_yen)";
    raceOrder: "decisionCutoff_ascending_then_canonicalRaceKey";
    expectedValueFormula: "model_probability * T-5_decimal_odds";
    positiveEvThreshold: number;
    positiveEvStrictComparison: true;
    positiveEvFloatingPointEpsilon: number;
  };
  separationRules: {
    predictiveMetricsMayUsePayout: false;
    predictiveMetricsMayUseSettlementLabel: true;
    economicTicketSelectionMayUseOfficialPayout: false;
    economicScoringMayUseOfficialPayoutAfterSelection: true;
    forcedTop1MayUseMarketOddsForSelection: false;
    positiveEvTop1MayUseMarketOddsForSelection: true;
    baselineSpecificThresholdTuningAllowed: false;
    sameCohortRequiredAcrossBaselines: true;
    sameStakeRequiredAcrossBaselines: true;
    sameSettlementRequiredAcrossBaselines: true;
  };
  authority: {
    automaticPromotionAuthorized: false;
    currentBuyConnectionAuthorized: false;
    lineConnectionAuthorized: false;
    publicPublishAuthorized: false;
    databaseWriteAuthorized: false;
    automatedBettingAuthorized: false;
    productionApplyAuthorized: false;
  };
  outputDigest: string;
};

export function buildN2MetricsDefinition(): N2MetricsDefinition {
  const core = {
    contractVersion: N2_METRICS_CONTRACT_VERSION,
    status: "FROZEN" as const,
    commonCohort: {
      requiredBaselineCount: N2_METRICS_REQUIRED_BASELINE_COUNT,
      requiredRaceCount: N2_METRICS_REQUIRED_RACE_COUNT,
      selectionsPerRace: N2_METRICS_SELECTIONS_PER_RACE,
      requiredPredictionRowCount: N2_METRICS_REQUIRED_COMMON_ROWS,
      exactRowIdentityRequired: true as const,
      exactLabelMatchRequired: true as const,
      exactDecisionCutoffMatchRequired: true as const,
      predictionCoverageFormula: "valid_common_prediction_rows / required_prediction_rows" as const,
      requiredPredictionCoverage: 1,
    },
    predictiveMetrics: {
      canonicalEvaluator: "evaluateN2Baseline" as const,
      primary: ["meanLogLoss", "calibrationEce"] as ["meanLogLoss", "calibrationEce"],
      diagnostics: ["meanBrier", "calibrationBins", "positiveCount", "rowCount"] as [
        "meanBrier",
        "calibrationBins",
        "positiveCount",
        "rowCount",
      ],
      logLossUnit: "binary_row_mean" as const,
      calibrationBinCount: N2_METRICS_CALIBRATION_BIN_COUNT,
      comparisonDirection: {
        meanLogLoss: "lower_is_better" as const,
        calibrationEce: "lower_is_better" as const,
        meanBrier: "lower_is_better" as const,
      },
    },
    economicEvaluation: {
      stakeYenPerTicket: N2_METRICS_FIXED_STAKE_YEN,
      officialPayoutUnitStakeYen: 100 as const,
      settlementSource: "clean_normal_resolved_trifecta_payout" as const,
      executionMarketSource: "accepted_private_T-5_market_only" as const,
      taxesAndFees: "excluded" as const,
      policies: [
        {
          policyId: "forced_top1" as const,
          selectionRule: "select highest model probability; market odds do not participate in ranking",
          marketOddsUsedForSelection: false,
          betCondition: "always bet exactly one ticket for every evaluable race",
          tieBreak: "selection_lexicographic_ascending" as const,
          maxTicketsPerRace: 1 as const,
        },
        {
          policyId: "positive_ev_top1" as const,
          selectionRule: "select highest model_probability * T-5_decimal_odds",
          marketOddsUsedForSelection: true,
          betCondition: "bet only when best expected gross multiple > 1 + epsilon",
          tieBreak: "selection_lexicographic_ascending" as const,
          maxTicketsPerRace: 1 as const,
        },
      ],
      betCoverageFormula: "bet_race_count / evaluable_race_count" as const,
      returnRatePctFormula: "total_return_yen / total_stake_yen * 100" as const,
      returnRateBreakEvenPct: 100,
      netRoiPctFormula: "(total_return_yen - total_stake_yen) / total_stake_yen * 100" as const,
      netRoiBreakEvenPct: 0,
      zeroStakeRoi: null,
      maxDrawdownFormula: "max(running_peak_net_profit_yen - cumulative_net_profit_yen)" as const,
      raceOrder: "decisionCutoff_ascending_then_canonicalRaceKey" as const,
      expectedValueFormula: "model_probability * T-5_decimal_odds" as const,
      positiveEvThreshold: N2_METRICS_POSITIVE_EV_THRESHOLD,
      positiveEvStrictComparison: true as const,
      positiveEvFloatingPointEpsilon: N2_METRICS_EV_EPSILON,
    },
    separationRules: {
      predictiveMetricsMayUsePayout: false as const,
      predictiveMetricsMayUseSettlementLabel: true as const,
      economicTicketSelectionMayUseOfficialPayout: false as const,
      economicScoringMayUseOfficialPayoutAfterSelection: true as const,
      forcedTop1MayUseMarketOddsForSelection: false as const,
      positiveEvTop1MayUseMarketOddsForSelection: true as const,
      baselineSpecificThresholdTuningAllowed: false as const,
      sameCohortRequiredAcrossBaselines: true as const,
      sameStakeRequiredAcrossBaselines: true as const,
      sameSettlementRequiredAcrossBaselines: true as const,
    },
    authority: {
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      databaseWriteAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
