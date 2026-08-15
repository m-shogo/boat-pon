import assert from "node:assert/strict";
import test from "node:test";
import { calculateBuyProbabilityCalibration } from "./buyProbabilityCalibration";

test("classifies overconfidence when predicted hit rate materially exceeds outcomes", () => {
  const result = calculateBuyProbabilityCalibration([
    { predicted: 0.4, hit: 0 },
    { predicted: 0.3, hit: 0 },
    { predicted: 0.2, hit: 0 },
    { predicted: 0.1, hit: 0 },
  ]);
  assert.equal(result.expectedHits, 1);
  assert.equal(result.observedHits, 0);
  assert.equal(result.averagePredictedHitRate, 0.25);
  assert.equal(result.observedHitRate, 0);
  assert.equal(result.calibrationBias, 0.25);
  assert.equal(result.brierScore, 0.075);
  assert.equal(result.classification, "OVERCONFIDENT");
});

test("keeps small calibration bias neutral", () => {
  const result = calculateBuyProbabilityCalibration([
    { predicted: 0.48, hit: 1 },
    { predicted: 0.48, hit: 0 },
  ]);
  assert.equal(result.calibrationBias, -0.02);
  assert.equal(result.classification, "WITHIN_5PT");
});

test("classifies material underconfidence", () => {
  const result = calculateBuyProbabilityCalibration([
    { predicted: 0.1, hit: 1 },
    { predicted: 0.2, hit: 0 },
  ]);
  assert.equal(result.observedHitRate, 0.5);
  assert.equal(result.averagePredictedHitRate, 0.15);
  assert.equal(result.classification, "UNDERCONFIDENT");
});

test("rejects invalid probabilities and empty calibration", () => {
  assert.throws(() => calculateBuyProbabilityCalibration([]), /requires eligible observations/u);
  assert.throws(() => calculateBuyProbabilityCalibration([{ predicted: 1.1, hit: 0 }]), /within \[0,1\]/u);
  assert.throws(() => calculateBuyProbabilityCalibration([{ predicted: Number.NaN, hit: 0 }]), /within \[0,1\]/u);
});
