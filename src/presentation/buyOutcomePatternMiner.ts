export type BuyOutcomeSegment = {
  dimension: "venue" | "modelVersion" | "confidenceBand" | "evBand" | "oddsBand" | "sampleBand";
  segmentKey: string;
  settled: number;
  hits: number;
  payoutOddsSum: number;
};

export type BuyOutcomePattern = {
  dimension: BuyOutcomeSegment["dimension"];
  segmentKey: string;
  direction: "SUCCESS_EDGE" | "FAILURE_REGIME";
  settled: number;
  hits: number;
  hitRate: number;
  roiProxy: number;
  baselineRoiProxy: number;
  roiDelta: number;
  confidence: "WATCH" | "STRONG";
  productionChangeAllowed: false;
};

export type PublicOutcomePatternSignal = {
  id: string;
  direction: BuyOutcomePattern["direction"];
  dimension: BuyOutcomePattern["dimension"];
  evidenceCount: number;
  roiDelta: number;
  confidence: BuyOutcomePattern["confidence"];
  productionChangeAllowed: false;
};

export function mineBuyOutcomePatterns(
  segments: BuyOutcomeSegment[],
  baseline: { settled: number; payoutOddsSum: number },
  options: { minSettled?: number; minRoiDelta?: number } = {},
): BuyOutcomePattern[] {
  const minSettled = options.minSettled ?? 30;
  const minRoiDelta = options.minRoiDelta ?? 0.15;
  const baselineRoi = ratio(baseline.payoutOddsSum, baseline.settled);
  if (baselineRoi === null) return [];

  return segments
    .filter((segment) => validSegment(segment) && segment.settled >= minSettled)
    .map((segment): BuyOutcomePattern | null => {
      const roi = ratio(segment.payoutOddsSum, segment.settled);
      const hitRate = ratio(segment.hits, segment.settled);
      if (roi === null || hitRate === null) return null;
      const delta = round4(roi - baselineRoi);
      if (Math.abs(delta) < minRoiDelta) return null;
      const direction = delta > 0 ? "SUCCESS_EDGE" : "FAILURE_REGIME";
      return {
        dimension: segment.dimension,
        segmentKey: segment.segmentKey,
        direction,
        settled: segment.settled,
        hits: segment.hits,
        hitRate,
        roiProxy: roi,
        baselineRoiProxy: baselineRoi,
        roiDelta: delta,
        confidence: segment.settled >= 100 && Math.abs(delta) >= 0.25 ? "STRONG" : "WATCH",
        productionChangeAllowed: false,
      };
    })
    .filter((pattern): pattern is BuyOutcomePattern => pattern !== null)
    .sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence === "STRONG" ? -1 : 1;
      if (Math.abs(a.roiDelta) !== Math.abs(b.roiDelta)) return Math.abs(b.roiDelta) - Math.abs(a.roiDelta);
      return b.settled - a.settled;
    });
}

export function toPublicOutcomePatternSignals(patterns: BuyOutcomePattern[], limit = 6): PublicOutcomePatternSignal[] {
  const seen = new Set<string>();
  const signals: PublicOutcomePatternSignal[] = [];
  for (const pattern of patterns) {
    // Public projection deliberately removes the segment value (venue/model/band identity).
    // The exact key remains private research evidence only.
    const identity = `${pattern.direction}:${pattern.dimension}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    signals.push({
      id: `PATTERN_${pattern.direction}_${pattern.dimension}`.toUpperCase(),
      direction: pattern.direction,
      dimension: pattern.dimension,
      evidenceCount: pattern.settled,
      roiDelta: pattern.roiDelta,
      confidence: pattern.confidence,
      productionChangeAllowed: false,
    });
    if (signals.length >= limit) break;
  }
  return signals;
}

function validSegment(segment: BuyOutcomeSegment): boolean {
  return segment.segmentKey.length > 0
    && Number.isInteger(segment.settled) && segment.settled >= 0
    && Number.isInteger(segment.hits) && segment.hits >= 0 && segment.hits <= segment.settled
    && Number.isFinite(segment.payoutOddsSum) && segment.payoutOddsSum >= 0;
}

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return round4(numerator / denominator);
}

function round4(value: number) { return Math.round(value * 10000) / 10000; }
