import assert from "node:assert/strict";
import test from "node:test";
import { summarizeBuyPatternDimensionReadiness } from "./buyPatternDimensionReadiness";

test("summarizes structural dimension readiness without using outcome quality", () => {
  const readiness = summarizeBuyPatternDimensionReadiness([
    { dimension: "venue", segmentKey: "private-a", settled: 30, hits: 30, payoutOddsSum: 900 },
    { dimension: "venue", segmentKey: "private-b", settled: 30, hits: 0, payoutOddsSum: 0 },
    { dimension: "modelVersion", segmentKey: "private-model", settled: 60, hits: 0, payoutOddsSum: 0 },
    { dimension: "confidenceBand", segmentKey: "private-band", settled: 60, hits: 60, payoutOddsSum: 900 },
    { dimension: "evBand", segmentKey: "private-ev", settled: 60, hits: 0, payoutOddsSum: 0 },
    { dimension: "oddsBand", segmentKey: "private-odds", settled: 40, hits: 0, payoutOddsSum: 0 },
    { dimension: "oddsBand", segmentKey: "private-odds-thin", settled: 20, hits: 20, payoutOddsSum: 900 },
  ], 60, 30);

  assert.deepEqual(readiness.find((item) => item.dimension === "venue"), {
    dimension: "venue", distinctCellCount: 2, eligibleCellCount: 2, universalEligibleCellCount: 0, closestComplementSettled: 30, comparisonReadyCellCount: 2,
  });
  assert.deepEqual(readiness.find((item) => item.dimension === "modelVersion"), {
    dimension: "modelVersion", distinctCellCount: 1, eligibleCellCount: 1, universalEligibleCellCount: 1, closestComplementSettled: 0, comparisonReadyCellCount: 0,
  });
  assert.deepEqual(readiness.find((item) => item.dimension === "confidenceBand"), {
    dimension: "confidenceBand", distinctCellCount: 1, eligibleCellCount: 1, universalEligibleCellCount: 1, closestComplementSettled: 0, comparisonReadyCellCount: 0,
  });
  assert.deepEqual(readiness.find((item) => item.dimension === "oddsBand"), {
    dimension: "oddsBand", distinctCellCount: 2, eligibleCellCount: 1, universalEligibleCellCount: 0, closestComplementSettled: 20, comparisonReadyCellCount: 0,
  });
  assert.deepEqual(readiness.find((item) => item.dimension === "sampleBand"), {
    dimension: "sampleBand", distinctCellCount: 0, eligibleCellCount: 0, universalEligibleCellCount: 0, closestComplementSettled: null, comparisonReadyCellCount: 0,
  });
  const publicSafe = JSON.stringify(readiness);
  assert.doesNotMatch(publicSafe, /private-a|private-b|private-model|private-band|private-ev|private-odds/u);
  assert.doesNotMatch(publicSafe, /segmentKey|hits|payoutOddsSum/u);
});

test("rejects invalid structural readiness thresholds", () => {
  assert.throws(() => summarizeBuyPatternDimensionReadiness([], -1, 30), /invalid BUY dimension readiness baseline/u);
  assert.throws(() => summarizeBuyPatternDimensionReadiness([], 60, 0), /invalid BUY dimension readiness support floor/u);
});
