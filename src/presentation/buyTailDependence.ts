export type BuyTailWindowInput = {
  settled: number;
  hits: number;
  payoutOddsSum: number;
  maxPayoutOdds: number;
};

export type BuyTailWindowAssessment = {
  settled: number;
  hits: number;
  roi: number | null;
  roiExMax: number | null;
  tailGap: number | null;
  tailDependent: boolean;
};

export type BuyTailDependenceStatus =
  | "INSUFFICIENT_SUPPORT"
  | "PERSISTENT_TAIL_DEPENDENCE"
  | "RECENT_TAIL_DEPENDENCE"
  | "PRIOR_TAIL_DEPENDENCE"
  | "NO_TAIL_DEPENDENCE_SIGNAL";

export type BuyTailDependenceAssessment = {
  status: BuyTailDependenceStatus;
  windowSize: number;
  minimumTailGap: number;
  recent: BuyTailWindowAssessment;
  prior: BuyTailWindowAssessment;
  missingSettledToCompare: number;
  productionChangeAllowed: false;
};

export function assessBuyTailDependence(
  recent: BuyTailWindowInput,
  prior: BuyTailWindowInput,
  options: { windowSize?: number; minimumTailGap?: number } = {},
): BuyTailDependenceAssessment {
  const windowSize = options.windowSize ?? 30;
  const minimumTailGap = options.minimumTailGap ?? 0.15;
  if (!Number.isInteger(windowSize) || windowSize < 10 || windowSize > 200) throw new Error("invalid BUY tail window size");
  if (!Number.isFinite(minimumTailGap) || minimumTailGap < 0.05 || minimumTailGap > 2) throw new Error("invalid BUY tail gap threshold");

  const recentAssessment = assessWindow(recent, windowSize, minimumTailGap);
  const priorAssessment = assessWindow(prior, windowSize, minimumTailGap);
  const missingSettledToCompare = Math.max(0, (windowSize * 2) - recentAssessment.settled - priorAssessment.settled);

  let status: BuyTailDependenceStatus = "INSUFFICIENT_SUPPORT";
  if (recentAssessment.settled === windowSize && priorAssessment.settled === windowSize) {
    if (recentAssessment.tailDependent && priorAssessment.tailDependent) status = "PERSISTENT_TAIL_DEPENDENCE";
    else if (recentAssessment.tailDependent) status = "RECENT_TAIL_DEPENDENCE";
    else if (priorAssessment.tailDependent) status = "PRIOR_TAIL_DEPENDENCE";
    else status = "NO_TAIL_DEPENDENCE_SIGNAL";
  }

  return {
    status,
    windowSize,
    minimumTailGap: round4(minimumTailGap),
    recent: recentAssessment,
    prior: priorAssessment,
    missingSettledToCompare,
    productionChangeAllowed: false,
  };
}

function assessWindow(input: BuyTailWindowInput, windowSize: number, minimumTailGap: number): BuyTailWindowAssessment {
  if (!validWindow(input) || input.settled > windowSize) throw new Error("invalid BUY tail window aggregate");
  const roi = ratio(input.payoutOddsSum, input.settled);
  const excludesMax = input.maxPayoutOdds > 0;
  const roiExMax = ratio(input.payoutOddsSum - (excludesMax ? input.maxPayoutOdds : 0), input.settled - (excludesMax ? 1 : 0));
  const tailGap = roi === null || roiExMax === null ? null : round4(roi - roiExMax);
  return {
    settled: input.settled,
    hits: input.hits,
    roi,
    roiExMax,
    tailGap,
    tailDependent: input.settled === windowSize && tailGap !== null && tailGap >= minimumTailGap,
  };
}

function validWindow(input: BuyTailWindowInput): boolean {
  return Number.isInteger(input.settled) && input.settled >= 0
    && Number.isInteger(input.hits) && input.hits >= 0 && input.hits <= input.settled
    && Number.isFinite(input.payoutOddsSum) && input.payoutOddsSum >= 0
    && Number.isFinite(input.maxPayoutOdds) && input.maxPayoutOdds >= 0
    && input.maxPayoutOdds <= input.payoutOddsSum;
}

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return round4(numerator / denominator);
}

function round4(value: number) { return Math.round(value * 10000) / 10000; }
