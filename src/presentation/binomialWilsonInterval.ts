export type WilsonInterval = {
  confidenceLevel: 0.95;
  method: "WILSON_SCORE";
  trials: number;
  successes: number;
  pointEstimate: number | null;
  lower: number | null;
  upper: number | null;
  width: number | null;
};

const Z_95 = 1.959963984540054;

export function wilson95(successes: number, trials: number): WilsonInterval {
  if (!Number.isInteger(trials) || trials < 0) throw new Error("invalid Wilson trial count");
  if (!Number.isInteger(successes) || successes < 0 || successes > trials) throw new Error("invalid Wilson success count");
  if (trials === 0) {
    return {
      confidenceLevel: 0.95,
      method: "WILSON_SCORE",
      trials,
      successes,
      pointEstimate: null,
      lower: null,
      upper: null,
      width: null,
    };
  }

  const p = successes / trials;
  const z2 = Z_95 * Z_95;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const halfWidth = (Z_95 * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  const lower = clamp(center - halfWidth);
  const upper = clamp(center + halfWidth);

  return {
    confidenceLevel: 0.95,
    method: "WILSON_SCORE",
    trials,
    successes,
    pointEstimate: round4(p),
    lower: round4(lower),
    upper: round4(upper),
    width: round4(upper - lower),
  };
}

function clamp(value: number) { return Math.min(1, Math.max(0, value)); }
function round4(value: number) { return Math.round(value * 10000) / 10000; }
