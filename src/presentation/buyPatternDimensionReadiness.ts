import type { BuyOutcomeSegment } from "./buyOutcomePatternMiner";

export const BUY_OUTCOME_PATTERN_DIMENSIONS: BuyOutcomeSegment["dimension"][] = [
  "venue",
  "modelVersion",
  "confidenceBand",
  "evBand",
  "oddsBand",
  "sampleBand",
];

export type BuyPatternDimensionReadiness = {
  dimension: BuyOutcomeSegment["dimension"];
  distinctCellCount: number;
  eligibleCellCount: number;
  universalEligibleCellCount: number;
  closestComplementSettled: number | null;
  comparisonReadyCellCount: number;
};

export function summarizeBuyPatternDimensionReadiness(
  segments: BuyOutcomeSegment[],
  baselineSettled: number,
  minimumSettledPerSide: number,
): BuyPatternDimensionReadiness[] {
  if (!Number.isInteger(baselineSettled) || baselineSettled < 0) throw new Error("invalid BUY dimension readiness baseline");
  if (!Number.isInteger(minimumSettledPerSide) || minimumSettledPerSide < 1) throw new Error("invalid BUY dimension readiness support floor");

  return BUY_OUTCOME_PATTERN_DIMENSIONS.map((dimension) => {
    const cells = segments.filter((segment) => segment.dimension === dimension
      && Number.isInteger(segment.settled)
      && segment.settled >= 0
      && segment.settled <= baselineSettled);
    const eligible = cells.filter((segment) => segment.settled >= minimumSettledPerSide);
    const complements = eligible.map((segment) => baselineSettled - segment.settled);
    return {
      dimension,
      distinctCellCount: cells.length,
      eligibleCellCount: eligible.length,
      universalEligibleCellCount: complements.filter((settled) => settled === 0).length,
      closestComplementSettled: complements.length ? Math.max(...complements) : null,
      comparisonReadyCellCount: complements.filter((settled) => settled >= minimumSettledPerSide).length,
    };
  });
}
