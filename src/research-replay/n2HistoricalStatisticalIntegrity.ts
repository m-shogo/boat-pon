import type { N2EdgeHistoricalConfirmationResult } from "./n2EdgeHistoricalConfirmation";

const ABSOLUTE_TOLERANCE = 1e-12;
const RELATIVE_TOLERANCE = 1e-9;
const NUMERIC_ZERO_P_FLOOR = 1e-8;
const MAX_ABSOLUTE_RACE_RESIDUAL = 1;

type Split = "validation" | "test";

function approximatelyEqual(actual: number, expected: number): boolean {
  const tolerance = Math.max(ABSOLUTE_TOLERANCE, Math.abs(expected) * RELATIVE_TOLERANCE);
  return Math.abs(actual - expected) <= tolerance;
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

function pValueMatches(actual: number, expected: number): boolean {
  if (!Number.isFinite(actual) || actual < 0 || actual > 1) return false;
  // The producer's normal approximation can underflow to exactly zero for very
  // large |z|. Accept only a tiny positive stored value in that case; it is
  // more conservative than zero and cannot cross the research alpha boundary.
  if (expected <= ABSOLUTE_TOLERANCE) return actual <= NUMERIC_ZERO_P_FLOOR;
  return approximatelyEqual(actual, expected);
}

function maxStandardErrorForBoundedResiduals(uniqueRaceCount: number, meanResidual: number): number {
  if (uniqueRaceCount <= 1) return 0;
  // For producer residuals x in [-1, 1], E[x^2] <= 1, hence population
  // variance <= 1 - mean^2. Converting to the producer's sample variance and
  // standard error gives SE^2 <= (1 - mean^2) / (n - 1). This is tighter than
  // the mean-independent Popoviciu bound and prevents mutually impossible
  // mean/SE pairs from being accepted after artifact re-hashing.
  const residualVarianceCeiling = Math.max(0, MAX_ABSOLUTE_RACE_RESIDUAL ** 2 - meanResidual ** 2);
  return Math.sqrt(residualVarianceCeiling / (uniqueRaceCount - 1));
}

function validateSplitStatistic(
  result: N2EdgeHistoricalConfirmationResult,
  split: Split,
): string[] {
  const value = result[split];
  const prefix = `${result.hypothesisId}:${split}`;
  const blockers: string[] = [];

  if (!Number.isSafeInteger(value.uniqueRaceCount) || value.uniqueRaceCount < 0) {
    blockers.push(`HISTORICAL_SPLIT_COUNT_INVALID:${prefix}`);
    return blockers;
  }

  if (value.uniqueRaceCount === 0) {
    if (value.meanResidual !== null || value.standardError !== null || value.zScore !== null || value.rawPValue !== 1) {
      blockers.push(`HISTORICAL_SPLIT_EMPTY_STATISTIC_INCONSISTENT:${prefix}`);
    }
    return blockers;
  }

  if (value.meanResidual === null || !Number.isFinite(value.meanResidual)) {
    blockers.push(`HISTORICAL_SPLIT_MEAN_INVALID:${prefix}`);
    return blockers;
  }
  if (Math.abs(value.meanResidual) > MAX_ABSOLUTE_RACE_RESIDUAL + ABSOLUTE_TOLERANCE) {
    blockers.push(`HISTORICAL_SPLIT_MEAN_OUT_OF_BOUNDS:${prefix}`);
    return blockers;
  }
  if (value.standardError === null || !Number.isFinite(value.standardError) || value.standardError < 0) {
    blockers.push(`HISTORICAL_SPLIT_STANDARD_ERROR_INVALID:${prefix}`);
    return blockers;
  }
  const maxStandardError = maxStandardErrorForBoundedResiduals(value.uniqueRaceCount, value.meanResidual);
  if (value.standardError > maxStandardError + ABSOLUTE_TOLERANCE) {
    blockers.push(`HISTORICAL_SPLIT_STANDARD_ERROR_OUT_OF_BOUNDS:${prefix}`);
    return blockers;
  }

  if (value.standardError === 0 && value.meanResidual !== 0) {
    if (value.zScore !== null || value.rawPValue !== 0) {
      blockers.push(`HISTORICAL_SPLIT_DEGENERATE_STATISTIC_INCONSISTENT:${prefix}`);
    }
    return blockers;
  }

  const expectedZ = value.standardError > 0 ? value.meanResidual / value.standardError : 0;
  if (value.zScore === null || !Number.isFinite(value.zScore) || !approximatelyEqual(value.zScore, expectedZ)) {
    blockers.push(`HISTORICAL_SPLIT_Z_SCORE_INCONSISTENT:${prefix}`);
    return blockers;
  }
  const expectedRawP = twoSidedNormalP(expectedZ);
  if (!pValueMatches(value.rawPValue, expectedRawP)) {
    blockers.push(`HISTORICAL_SPLIT_RAW_P_VALUE_INCONSISTENT:${prefix}`);
  }
  return blockers;
}

function validateHolm(
  results: readonly N2EdgeHistoricalConfirmationResult[],
  split: Split,
): string[] {
  const blockers: string[] = [];
  const ordered = [...results].sort((left, right) =>
    left[split].rawPValue - right[split].rawPValue || left.hypothesisId.localeCompare(right.hypothesisId),
  );
  let prior = 0;
  ordered.forEach((result, index) => {
    const rawP = result[split].rawPValue;
    if (!Number.isFinite(rawP) || rawP < 0 || rawP > 1) return;
    const expected = Math.min(1, Math.max(prior, rawP * (ordered.length - index)));
    prior = expected;
    const actual = result[split].holmAdjustedPValue;
    const matches = expected <= NUMERIC_ZERO_P_FLOOR
      ? Number.isFinite(actual) && actual >= rawP && actual <= NUMERIC_ZERO_P_FLOOR
      : Number.isFinite(actual) && approximatelyEqual(actual, expected);
    if (!matches) blockers.push(`HISTORICAL_SPLIT_HOLM_INCONSISTENT:${result.hypothesisId}:${split}`);
  });
  return blockers;
}

export function validateN2HistoricalStatisticalIntegrity(
  results: readonly N2EdgeHistoricalConfirmationResult[],
): string[] {
  const blockers: string[] = [];
  for (const result of results) {
    blockers.push(...validateSplitStatistic(result, "validation"));
    blockers.push(...validateSplitStatistic(result, "test"));
  }
  blockers.push(...validateHolm(results, "validation"), ...validateHolm(results, "test"));
  return [...new Set(blockers)].sort();
}
