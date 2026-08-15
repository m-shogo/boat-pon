import type { BuyCalibrationClassification, BuyCalibrationMetrics } from "./buyProbabilityCalibration";

export type BuyCalibrationStabilityStatus =
  | "INSUFFICIENT_SUPPORT"
  | "STABLE_WITHIN_5PT"
  | "PERSISTENT_OVERCONFIDENCE"
  | "PERSISTENT_UNDERCONFIDENCE"
  | "CALIBRATION_REGIME_CHANGED";

export type BuyCalibrationWindow = {
  settled: number;
  probabilityEligible: number;
  missingProbability: number;
  metrics: BuyCalibrationMetrics | null;
};

export type BuyCalibrationStability = {
  status: BuyCalibrationStabilityStatus;
  windowSize: number;
  requiredSettled: number;
  totalSettled: number;
  missingSettledToCompare: number;
  recent: BuyCalibrationWindow;
  prior: BuyCalibrationWindow;
  productionChangeAllowed: false;
};

export function classifyBuyCalibrationStability(input: {
  totalSettled: number;
  windowSize: number;
  minimumEligible: number;
  recent: BuyCalibrationWindow;
  prior: BuyCalibrationWindow;
}): BuyCalibrationStability {
  const { totalSettled, windowSize, minimumEligible, recent, prior } = input;
  if (!Number.isInteger(totalSettled) || totalSettled < 0) throw new Error("invalid calibration stability totalSettled");
  if (!Number.isInteger(windowSize) || windowSize < 2) throw new Error("invalid calibration stability windowSize");
  if (!Number.isInteger(minimumEligible) || minimumEligible < 1 || minimumEligible > windowSize) throw new Error("invalid calibration stability minimumEligible");
  validateWindow(recent, windowSize);
  validateWindow(prior, windowSize);

  const requiredSettled = windowSize * 2;
  const missingSettledToCompare = Math.max(0, requiredSettled - totalSettled);
  const complete = missingSettledToCompare === 0
    && recent.settled === windowSize
    && prior.settled === windowSize
    && recent.probabilityEligible >= minimumEligible
    && prior.probabilityEligible >= minimumEligible
    && recent.metrics !== null
    && prior.metrics !== null;

  if (!complete) {
    return {
      status: "INSUFFICIENT_SUPPORT",
      windowSize,
      requiredSettled,
      totalSettled,
      missingSettledToCompare,
      recent,
      prior,
      productionChangeAllowed: false,
    };
  }

  return {
    status: classifyPair(recent.metrics!.classification, prior.metrics!.classification),
    windowSize,
    requiredSettled,
    totalSettled,
    missingSettledToCompare: 0,
    recent,
    prior,
    productionChangeAllowed: false,
  };
}

function classifyPair(recent: BuyCalibrationClassification, prior: BuyCalibrationClassification): BuyCalibrationStabilityStatus {
  if (recent === "WITHIN_5PT" && prior === "WITHIN_5PT") return "STABLE_WITHIN_5PT";
  if (recent === "OVERCONFIDENT" && prior === "OVERCONFIDENT") return "PERSISTENT_OVERCONFIDENCE";
  if (recent === "UNDERCONFIDENT" && prior === "UNDERCONFIDENT") return "PERSISTENT_UNDERCONFIDENCE";
  return "CALIBRATION_REGIME_CHANGED";
}

function validateWindow(window: BuyCalibrationWindow, windowSize: number) {
  if (!Number.isInteger(window.settled) || window.settled < 0 || window.settled > windowSize) throw new Error("invalid calibration stability window settled");
  if (!Number.isInteger(window.probabilityEligible) || window.probabilityEligible < 0 || window.probabilityEligible > window.settled) throw new Error("invalid calibration stability eligible count");
  if (!Number.isInteger(window.missingProbability) || window.missingProbability !== window.settled - window.probabilityEligible) throw new Error("invalid calibration stability missing probability count");
  if ((window.metrics === null) !== (window.probabilityEligible === 0)) {
    if (window.metrics !== null && window.metrics.eligible !== window.probabilityEligible) throw new Error("calibration stability metric eligible mismatch");
  }
  if (window.metrics !== null && window.metrics.eligible !== window.probabilityEligible) throw new Error("calibration stability metric eligible mismatch");
}
