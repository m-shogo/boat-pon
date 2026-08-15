import assert from "node:assert/strict";
import test from "node:test";
import { classifyBuyCalibrationStability, type BuyCalibrationWindow } from "./buyCalibrationStability";
import type { BuyCalibrationClassification } from "./buyProbabilityCalibration";

function window(classification: BuyCalibrationClassification, eligible = 30): BuyCalibrationWindow {
  return {
    settled: 30,
    probabilityEligible: eligible,
    missingProbability: 30 - eligible,
    metrics: eligible > 0 ? {
      eligible,
      expectedHits: classification === "OVERCONFIDENT" ? 6 : classification === "UNDERCONFIDENT" ? 1 : 2,
      observedHits: classification === "OVERCONFIDENT" ? 1 : classification === "UNDERCONFIDENT" ? 4 : 1,
      averagePredictedHitRate: classification === "OVERCONFIDENT" ? 0.2 : classification === "UNDERCONFIDENT" ? 0.03 : 0.06,
      observedHitRate: classification === "OVERCONFIDENT" ? 0.0333 : classification === "UNDERCONFIDENT" ? 0.1333 : 0.0333,
      calibrationBias: classification === "OVERCONFIDENT" ? 0.1667 : classification === "UNDERCONFIDENT" ? -0.1033 : 0.0267,
      brierScore: 0.04,
      classification,
    } : null,
  };
}

test("requires two complete independent windows", () => {
  const result = classifyBuyCalibrationStability({
    totalSettled: 59,
    windowSize: 30,
    minimumEligible: 30,
    recent: window("WITHIN_5PT"),
    prior: { ...window("WITHIN_5PT"), settled: 29, probabilityEligible: 29, missingProbability: 0, metrics: { ...window("WITHIN_5PT", 29).metrics!, eligible: 29 } },
  });
  assert.equal(result.status, "INSUFFICIENT_SUPPORT");
  assert.equal(result.requiredSettled, 60);
  assert.equal(result.missingSettledToCompare, 1);
});

test("classifies stable within-five-point calibration", () => {
  const result = classifyBuyCalibrationStability({ totalSettled: 61, windowSize: 30, minimumEligible: 30, recent: window("WITHIN_5PT"), prior: window("WITHIN_5PT") });
  assert.equal(result.status, "STABLE_WITHIN_5PT");
  assert.equal(result.missingSettledToCompare, 0);
  assert.equal(result.productionChangeAllowed, false);
});

test("classifies persistent directional bias only when both windows agree", () => {
  assert.equal(classifyBuyCalibrationStability({ totalSettled: 60, windowSize: 30, minimumEligible: 30, recent: window("OVERCONFIDENT"), prior: window("OVERCONFIDENT") }).status, "PERSISTENT_OVERCONFIDENCE");
  assert.equal(classifyBuyCalibrationStability({ totalSettled: 60, windowSize: 30, minimumEligible: 30, recent: window("UNDERCONFIDENT"), prior: window("UNDERCONFIDENT") }).status, "PERSISTENT_UNDERCONFIDENCE");
});

test("flags changing calibration regimes rather than averaging them away", () => {
  const result = classifyBuyCalibrationStability({ totalSettled: 60, windowSize: 30, minimumEligible: 30, recent: window("WITHIN_5PT"), prior: window("OVERCONFIDENT") });
  assert.equal(result.status, "CALIBRATION_REGIME_CHANGED");
});

test("probability coverage must satisfy the per-window support floor", () => {
  const result = classifyBuyCalibrationStability({ totalSettled: 60, windowSize: 30, minimumEligible: 30, recent: window("WITHIN_5PT", 29), prior: window("WITHIN_5PT") });
  assert.equal(result.status, "INSUFFICIENT_SUPPORT");
});
