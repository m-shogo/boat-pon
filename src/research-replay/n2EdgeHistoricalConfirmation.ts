import { canonicalHash } from "./canonical";
import {
  N2_EDGE_SCAN_ALPHA,
  N2_EDGE_SCAN_MAX_SIGNALS,
  N2_EDGE_SCAN_MIN_ABSOLUTE_RESIDUAL,
  N2_EDGE_SCAN_MIN_UNIQUE_RACES,
  type N2EdgeHypothesis,
} from "./n2EdgeHypothesisScan";
import { splitForN2RaceKey } from "./n2BaselineEvaluation";

export const N2_EDGE_HISTORICAL_CONFIRMATION_VERSION =
  "n2-edge-historical-confirmation-v1" as const;

export type N2EdgeConfirmationSplit = "validation" | "test";

export type N2EdgeConfirmationRace = {
  canonicalRaceKey: string;
  split: N2EdgeConfirmationSplit;
  /** Race-level means only. Selection rows must already be collapsed. */
  residualByHypothesisId: Record<string, number>;
};

export type N2EdgeConfirmationSplitResult = {
  split: N2EdgeConfirmationSplit;
  uniqueRaceCount: number;
  meanResidual: number | null;
  standardError: number | null;
  zScore: number | null;
  rawPValue: number;
  holmAdjustedPValue: number;
  supportSufficient: boolean;
  effectSufficient: boolean;
  directionMatchesDiscovery: boolean;
  statisticallyConfirmed: boolean;
};

export type N2EdgeHistoricalConfirmationResult = {
  hypothesisId: string;
  featureKey: string;
  bucket: string;
  discoveryDirection: "underpredicted" | "overpredicted";
  validation: N2EdgeConfirmationSplitResult;
  test: N2EdgeConfirmationSplitResult;
  verdict: "HISTORICAL_CONFIRMED" | "HISTORICAL_REJECTED" | "INSUFFICIENT_HOLDOUT";
};

export type N2EdgeHistoricalConfirmationReport = {
  confirmationVersion: typeof N2_EDGE_HISTORICAL_CONFIRMATION_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  lockedHypothesisCount: number;
  validationRaceCount: number;
  testRaceCount: number;
  confirmationMethod: {
    rediscoveryAllowed: false;
    interactionSearchAllowed: false;
    raceLevelResidualRequired: true;
    minUniqueRacesPerSplit: number;
    minAbsoluteResidual: number;
    familyWiseAlpha: number;
    multipleTesting: "Holm-Bonferroni separately within validation and test";
    bothHoldoutSplitsRequired: true;
    sameDirectionRequired: true;
    forwardShadowUsed: false;
  };
  confirmedCount: number;
  rejectedCount: number;
  insufficientCount: number;
  results: N2EdgeHistoricalConfirmationResult[];
  authority: {
    roiUsedForConfirmation: false;
    payoutUsedForConfirmation: false;
    trainLabelsUsedForConfirmation: false;
    forwardLabelsUsedForConfirmation: false;
    automaticPromotionAuthorized: false;
    currentBuyConnectionAuthorized: false;
    lineConnectionAuthorized: false;
    publicPublishAuthorized: false;
    automatedBettingAuthorized: false;
    productionApplyAuthorized: false;
  };
  outputDigest: string;
};

type OnlineStats = { count: number; mean: number; m2: number };
type RawSplitResult = Omit<N2EdgeConfirmationSplitResult, "holmAdjustedPValue" | "statisticallyConfirmed">;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function normalCdf(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (!Number.isFinite(value)) return Number.NaN;
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = sign * (1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function twoSidedNormalP(zScore: number): number {
  if (Number.isNaN(zScore)) return 1;
  if (Math.abs(zScore) === Number.POSITIVE_INFINITY) return 0;
  return Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(zScore)))));
}

function add(stats: OnlineStats, value: number): void {
  stats.count += 1;
  const delta = value - stats.mean;
  stats.mean += delta / stats.count;
  const delta2 = value - stats.mean;
  stats.m2 += delta * delta2;
}

function rawResult(
  split: N2EdgeConfirmationSplit,
  stats: OnlineStats,
  direction: N2EdgeHypothesis["direction"],
): RawSplitResult {
  const supportSufficient = stats.count >= N2_EDGE_SCAN_MIN_UNIQUE_RACES;
  if (stats.count === 0) {
    return {
      split,
      uniqueRaceCount: 0,
      meanResidual: null,
      standardError: null,
      zScore: null,
      rawPValue: 1,
      supportSufficient: false,
      effectSufficient: false,
      directionMatchesDiscovery: false,
    };
  }
  const variance = stats.count <= 1 ? 0 : stats.m2 / (stats.count - 1);
  const standardError = Math.sqrt(variance / stats.count);
  const zScore = standardError > 0
    ? stats.mean / standardError
    : stats.mean === 0 ? 0 : Math.sign(stats.mean) * Number.POSITIVE_INFINITY;
  const directionMatchesDiscovery = direction === "underpredicted" ? stats.mean > 0 : stats.mean < 0;
  return {
    split,
    uniqueRaceCount: stats.count,
    meanResidual: stats.mean,
    standardError,
    zScore,
    rawPValue: twoSidedNormalP(zScore),
    supportSufficient,
    effectSufficient: Math.abs(stats.mean) >= N2_EDGE_SCAN_MIN_ABSOLUTE_RESIDUAL,
    directionMatchesDiscovery,
  };
}

function holmAdjust(
  rawByHypothesis: Map<string, RawSplitResult>,
): Map<string, number> {
  const ordered = [...rawByHypothesis.entries()].sort((left, right) =>
    left[1].rawPValue - right[1].rawPValue || left[0].localeCompare(right[0]),
  );
  let prior = 0;
  const adjusted = new Map<string, number>();
  ordered.forEach(([hypothesisId, result], index) => {
    const value = Math.min(1, Math.max(prior, result.rawPValue * (ordered.length - index)));
    prior = value;
    adjusted.set(hypothesisId, value);
  });
  return adjusted;
}

function blocked(blockers: string[], lockedHypothesisCount: number): N2EdgeHistoricalConfirmationReport {
  const core = {
    confirmationVersion: N2_EDGE_HISTORICAL_CONFIRMATION_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(blockers),
    lockedHypothesisCount,
    validationRaceCount: 0,
    testRaceCount: 0,
    confirmationMethod: {
      rediscoveryAllowed: false as const,
      interactionSearchAllowed: false as const,
      raceLevelResidualRequired: true as const,
      minUniqueRacesPerSplit: N2_EDGE_SCAN_MIN_UNIQUE_RACES,
      minAbsoluteResidual: N2_EDGE_SCAN_MIN_ABSOLUTE_RESIDUAL,
      familyWiseAlpha: N2_EDGE_SCAN_ALPHA,
      multipleTesting: "Holm-Bonferroni separately within validation and test" as const,
      bothHoldoutSplitsRequired: true as const,
      sameDirectionRequired: true as const,
      forwardShadowUsed: false as const,
    },
    confirmedCount: 0,
    rejectedCount: 0,
    insufficientCount: 0,
    results: [] as N2EdgeHistoricalConfirmationResult[],
    authority: {
      roiUsedForConfirmation: false as const,
      payoutUsedForConfirmation: false as const,
      trainLabelsUsedForConfirmation: false as const,
      forwardLabelsUsedForConfirmation: false as const,
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

export function confirmN2EdgeHypothesesHistorically(input: {
  lockedHypotheses: N2EdgeHypothesis[];
  races: N2EdgeConfirmationRace[];
}): N2EdgeHistoricalConfirmationReport {
  const blockers: string[] = [];
  if (input.lockedHypotheses.length > N2_EDGE_SCAN_MAX_SIGNALS) {
    blockers.push(`LOCKED_HYPOTHESIS_COUNT:${input.lockedHypotheses.length}/${N2_EDGE_SCAN_MAX_SIGNALS}`);
  }
  const hypothesisById = new Map<string, N2EdgeHypothesis>();
  for (const hypothesis of input.lockedHypotheses) {
    if (hypothesisById.has(hypothesis.hypothesisId)) blockers.push(`DUPLICATE_HYPOTHESIS_ID:${hypothesis.hypothesisId}`);
    hypothesisById.set(hypothesis.hypothesisId, hypothesis);
  }
  const seenRaceKeys = new Set<string>();
  for (const race of input.races) {
    const canonicalSplit = splitForN2RaceKey(race.canonicalRaceKey);
    if (canonicalSplit !== race.split) blockers.push(`SPLIT_MISMATCH:${race.canonicalRaceKey}:${race.split}/${canonicalSplit ?? "INVALID"}`);
    if (race.split !== "validation" && race.split !== "test") blockers.push(`NON_HOLDOUT_SPLIT:${race.split}`);
    if (seenRaceKeys.has(race.canonicalRaceKey)) blockers.push(`DUPLICATE_RACE:${race.canonicalRaceKey}`);
    seenRaceKeys.add(race.canonicalRaceKey);
    for (const [hypothesisId, residual] of Object.entries(race.residualByHypothesisId)) {
      if (!hypothesisById.has(hypothesisId)) blockers.push(`UNKNOWN_HYPOTHESIS_ID:${hypothesisId}`);
      if (!Number.isFinite(residual) || residual < -1 || residual > 1) blockers.push(`${hypothesisId}:INVALID_RACE_RESIDUAL`);
    }
  }
  if (blockers.length > 0) return blocked(blockers, input.lockedHypotheses.length);

  const statsBySplit: Record<N2EdgeConfirmationSplit, Map<string, OnlineStats>> = {
    validation: new Map(),
    test: new Map(),
  };
  for (const split of ["validation", "test"] as const) {
    for (const hypothesis of input.lockedHypotheses) {
      statsBySplit[split].set(hypothesis.hypothesisId, { count: 0, mean: 0, m2: 0 });
    }
  }
  for (const race of input.races) {
    for (const [hypothesisId, residual] of Object.entries(race.residualByHypothesisId)) {
      add(statsBySplit[race.split].get(hypothesisId)!, residual);
    }
  }

  const rawBySplit: Record<N2EdgeConfirmationSplit, Map<string, RawSplitResult>> = {
    validation: new Map(),
    test: new Map(),
  };
  for (const split of ["validation", "test"] as const) {
    for (const hypothesis of input.lockedHypotheses) {
      rawBySplit[split].set(
        hypothesis.hypothesisId,
        rawResult(split, statsBySplit[split].get(hypothesis.hypothesisId)!, hypothesis.direction),
      );
    }
  }
  const adjustedValidation = holmAdjust(rawBySplit.validation);
  const adjustedTest = holmAdjust(rawBySplit.test);

  const results = input.lockedHypotheses
    .map((hypothesis): N2EdgeHistoricalConfirmationResult => {
      const rawValidation = rawBySplit.validation.get(hypothesis.hypothesisId)!;
      const rawTest = rawBySplit.test.get(hypothesis.hypothesisId)!;
      const validationAdjusted = adjustedValidation.get(hypothesis.hypothesisId)!;
      const testAdjusted = adjustedTest.get(hypothesis.hypothesisId)!;
      const validation: N2EdgeConfirmationSplitResult = {
        ...rawValidation,
        holmAdjustedPValue: validationAdjusted,
        statisticallyConfirmed: rawValidation.supportSufficient
          && rawValidation.effectSufficient
          && rawValidation.directionMatchesDiscovery
          && validationAdjusted <= N2_EDGE_SCAN_ALPHA,
      };
      const test: N2EdgeConfirmationSplitResult = {
        ...rawTest,
        holmAdjustedPValue: testAdjusted,
        statisticallyConfirmed: rawTest.supportSufficient
          && rawTest.effectSufficient
          && rawTest.directionMatchesDiscovery
          && testAdjusted <= N2_EDGE_SCAN_ALPHA,
      };
      const verdict = !validation.supportSufficient || !test.supportSufficient
        ? "INSUFFICIENT_HOLDOUT" as const
        : validation.statisticallyConfirmed && test.statisticallyConfirmed
          ? "HISTORICAL_CONFIRMED" as const
          : "HISTORICAL_REJECTED" as const;
      return {
        hypothesisId: hypothesis.hypothesisId,
        featureKey: hypothesis.featureKey,
        bucket: hypothesis.bucket,
        discoveryDirection: hypothesis.direction,
        validation,
        test,
        verdict,
      };
    })
    .sort((left, right) => left.hypothesisId.localeCompare(right.hypothesisId));

  const validationRaceCount = input.races.filter((race) => race.split === "validation").length;
  const testRaceCount = input.races.filter((race) => race.split === "test").length;
  const core = {
    confirmationVersion: N2_EDGE_HISTORICAL_CONFIRMATION_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    lockedHypothesisCount: input.lockedHypotheses.length,
    validationRaceCount,
    testRaceCount,
    confirmationMethod: {
      rediscoveryAllowed: false as const,
      interactionSearchAllowed: false as const,
      raceLevelResidualRequired: true as const,
      minUniqueRacesPerSplit: N2_EDGE_SCAN_MIN_UNIQUE_RACES,
      minAbsoluteResidual: N2_EDGE_SCAN_MIN_ABSOLUTE_RESIDUAL,
      familyWiseAlpha: N2_EDGE_SCAN_ALPHA,
      multipleTesting: "Holm-Bonferroni separately within validation and test" as const,
      bothHoldoutSplitsRequired: true as const,
      sameDirectionRequired: true as const,
      forwardShadowUsed: false as const,
    },
    confirmedCount: results.filter((result) => result.verdict === "HISTORICAL_CONFIRMED").length,
    rejectedCount: results.filter((result) => result.verdict === "HISTORICAL_REJECTED").length,
    insufficientCount: results.filter((result) => result.verdict === "INSUFFICIENT_HOLDOUT").length,
    results,
    authority: {
      roiUsedForConfirmation: false as const,
      payoutUsedForConfirmation: false as const,
      trainLabelsUsedForConfirmation: false as const,
      forwardLabelsUsedForConfirmation: false as const,
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
