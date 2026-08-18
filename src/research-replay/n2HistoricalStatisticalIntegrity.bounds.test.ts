import assert from "node:assert/strict";
import test from "node:test";

import type { N2EdgeHistoricalConfirmationResult } from "./n2EdgeHistoricalConfirmation";
import { validateN2HistoricalStatisticalIntegrity } from "./n2HistoricalStatisticalIntegrity";

function emptySplit(split: "validation" | "test") {
  return {
    split,
    uniqueRaceCount: 0,
    meanResidual: null,
    standardError: null,
    zScore: null,
    rawPValue: 1,
    holmAdjustedPValue: 1,
    supportSufficient: false,
    effectSufficient: false,
    directionMatchesDiscovery: false,
    statisticallyConfirmed: false,
  } as const;
}

function resultWithValidation(
  validation: N2EdgeHistoricalConfirmationResult["validation"],
): N2EdgeHistoricalConfirmationResult {
  return {
    hypothesisId: "N2EDGE-bounded-statistics",
    featureKey: "fixture_feature",
    bucket: "fixture_bucket",
    discoveryDirection: "underpredicted",
    validation,
    test: emptySplit("test"),
    verdict: "INSUFFICIENT_HOLDOUT",
  };
}

test("rejects a historical mean residual that producer-bounded race residuals cannot generate", () => {
  const result = resultWithValidation({
    split: "validation",
    uniqueRaceCount: 200,
    meanResidual: 1.0001,
    standardError: 0,
    zScore: null,
    rawPValue: 0,
    holmAdjustedPValue: 0,
    supportSufficient: true,
    effectSufficient: true,
    directionMatchesDiscovery: true,
    statisticallyConfirmed: true,
  });

  const blockers = validateN2HistoricalStatisticalIntegrity([result]);
  assert.ok(blockers.includes("HISTORICAL_SPLIT_MEAN_OUT_OF_BOUNDS:N2EDGE-bounded-statistics:validation"));
});

test("rejects a standard error above the mathematical maximum for residuals in [-1, 1]", () => {
  const result = resultWithValidation({
    split: "validation",
    uniqueRaceCount: 200,
    meanResidual: 0,
    standardError: 1,
    zScore: 0,
    rawPValue: 1,
    holmAdjustedPValue: 1,
    supportSufficient: true,
    effectSufficient: false,
    directionMatchesDiscovery: false,
    statisticallyConfirmed: false,
  });

  const blockers = validateN2HistoricalStatisticalIntegrity([result]);
  assert.ok(blockers.includes("HISTORICAL_SPLIT_STANDARD_ERROR_OUT_OF_BOUNDS:N2EDGE-bounded-statistics:validation"));
});

test("keeps producer-valid boundary statistics accepted", () => {
  const result = resultWithValidation({
    split: "validation",
    uniqueRaceCount: 200,
    meanResidual: 1,
    standardError: 0,
    zScore: null,
    rawPValue: 0,
    holmAdjustedPValue: 0,
    supportSufficient: true,
    effectSufficient: true,
    directionMatchesDiscovery: true,
    statisticallyConfirmed: true,
  });

  assert.deepEqual(validateN2HistoricalStatisticalIntegrity([result]), []);
});
