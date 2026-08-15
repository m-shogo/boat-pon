export type BuyCalibrationClassification =
  | "OVERCONFIDENT"
  | "UNDERCONFIDENT"
  | "WITHIN_5PT";

export type BuyCalibrationObservation = {
  predicted: number;
  hit: 0 | 1;
};

export type BuyCalibrationMetrics = {
  eligible: number;
  expectedHits: number;
  observedHits: number;
  averagePredictedHitRate: number;
  observedHitRate: number;
  calibrationBias: number;
  brierScore: number;
  classification: BuyCalibrationClassification;
};

const MATERIAL_BIAS = 0.05;

export function calculateBuyProbabilityCalibration(observations: BuyCalibrationObservation[]): BuyCalibrationMetrics {
  if (!observations.length) throw new Error("BUY probability calibration requires eligible observations");
  let expectedHits = 0;
  let observedHits = 0;
  let brierSum = 0;
  for (const observation of observations) {
    if (!Number.isFinite(observation.predicted) || observation.predicted < 0 || observation.predicted > 1) {
      throw new Error("BUY predicted hit rate must be within [0,1]");
    }
    if (observation.hit !== 0 && observation.hit !== 1) throw new Error("BUY calibration outcome must be binary");
    expectedHits += observation.predicted;
    observedHits += observation.hit;
    brierSum += (observation.predicted - observation.hit) ** 2;
  }
  const eligible = observations.length;
  const averagePredictedHitRate = expectedHits / eligible;
  const observedHitRate = observedHits / eligible;
  const calibrationBias = averagePredictedHitRate - observedHitRate;
  return {
    eligible,
    expectedHits: round4(expectedHits),
    observedHits,
    averagePredictedHitRate: round4(averagePredictedHitRate),
    observedHitRate: round4(observedHitRate),
    calibrationBias: round4(calibrationBias),
    brierScore: round4(brierSum / eligible),
    classification: calibrationBias >= MATERIAL_BIAS
      ? "OVERCONFIDENT"
      : calibrationBias <= -MATERIAL_BIAS
        ? "UNDERCONFIDENT"
        : "WITHIN_5PT",
  };
}

function round4(value: number): number { return Math.round(value * 10000) / 10000; }
