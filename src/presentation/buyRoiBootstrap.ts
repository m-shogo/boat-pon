export type BuyRoiBootstrapClassification =
  | "BELOW_BREAK_EVEN"
  | "CROSSES_BREAK_EVEN"
  | "ABOVE_BREAK_EVEN";

export type BuyRoiBootstrapInterval = {
  confidenceLevel: 0.95;
  method: "DETERMINISTIC_PERCENTILE_BOOTSTRAP";
  trials: number;
  iterations: number;
  pointEstimate: number;
  lower: number;
  upper: number;
  width: number;
  breakEven: 1;
  classification: BuyRoiBootstrapClassification;
};

const BREAK_EVEN = 1;

/**
 * Deterministic non-parametric percentile bootstrap for unit-stake realized ROI.
 *
 * This describes sampling uncertainty in the observed payout distribution only.
 * It is not a predictive guarantee and deliberately stays separate from BUY rules.
 */
export function bootstrapRoi95(
  rawValues: number[],
  iterations = 5000,
): BuyRoiBootstrapInterval {
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 50000) {
    throw new Error("BUY ROI bootstrap iterations must be an integer between 1000 and 50000");
  }
  if (!rawValues.length) throw new Error("BUY ROI bootstrap requires at least one settled outcome");

  const values = rawValues.map(validatePayout).sort((a, b) => a - b);
  const trials = values.length;
  const pointEstimate = mean(values);
  const nextRandom = xorshift32(seedFor(values));
  const means = new Array<number>(iterations);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let sample = 0; sample < trials; sample += 1) {
      const index = Math.floor(nextRandom() * trials);
      sum += values[index]!;
    }
    means[iteration] = sum / trials;
  }

  means.sort((a, b) => a - b);
  const lower = percentile(means, 0.025);
  const upper = percentile(means, 0.975);
  const roundedPoint = round4(pointEstimate);
  const roundedLower = round4(lower);
  const roundedUpper = round4(upper);

  return {
    confidenceLevel: 0.95,
    method: "DETERMINISTIC_PERCENTILE_BOOTSTRAP",
    trials,
    iterations,
    pointEstimate: roundedPoint,
    lower: roundedLower,
    upper: roundedUpper,
    width: round4(Math.max(0, roundedUpper - roundedLower)),
    breakEven: BREAK_EVEN,
    classification: classify(roundedLower, roundedUpper),
  };
}

function validatePayout(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("BUY ROI bootstrap payouts must be finite and non-negative");
  return value;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sorted: number[], probability: number): number {
  const index = Math.floor((sorted.length - 1) * probability);
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]!;
}

function classify(lower: number, upper: number): BuyRoiBootstrapClassification {
  if (lower > BREAK_EVEN) return "ABOVE_BREAK_EVEN";
  if (upper < BREAK_EVEN) return "BELOW_BREAK_EVEN";
  return "CROSSES_BREAK_EVEN";
}

function seedFor(values: number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const scaled = Math.round(value * 10000);
    hash ^= scaled & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (scaled >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (scaled >>> 16) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (scaled >>> 24) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= values.length;
  return (hash >>> 0) || 0x9e3779b9;
}

function xorshift32(initialState: number): () => number {
  let state = initialState >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
