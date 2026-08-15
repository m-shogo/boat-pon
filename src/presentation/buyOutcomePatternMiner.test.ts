import { describe, expect, it } from "vitest";
import { mineBuyOutcomePatterns, toPublicOutcomePatternSignals } from "./buyOutcomePatternMiner";

describe("mineBuyOutcomePatterns", () => {
  it("detects repeatable success/failure segments without allowing production changes", () => {
    const patterns = mineBuyOutcomePatterns([
      { dimension: "venue", segmentKey: "private-venue-a", settled: 120, hits: 30, payoutOddsSum: 150 },
      { dimension: "venue", segmentKey: "private-venue-b", settled: 90, hits: 10, payoutOddsSum: 54 },
      { dimension: "evBand", segmentKey: "1.2-1.4", settled: 8, hits: 1, payoutOddsSum: 20 },
    ], { settled: 300, payoutOddsSum: 300 });

    expect(patterns).toHaveLength(2);
    expect(patterns[0].productionChangeAllowed).toBe(false);
    expect(patterns.some((item) => item.direction === "SUCCESS_EDGE")).toBe(true);
    expect(patterns.some((item) => item.direction === "FAILURE_REGIME")).toBe(true);
    expect(patterns.every((item) => item.segmentKey !== "1.2-1.4")).toBe(true);
  });

  it("does not surface weak or tiny segments", () => {
    const patterns = mineBuyOutcomePatterns([
      { dimension: "sampleBand", segmentKey: "30-99", settled: 29, hits: 5, payoutOddsSum: 5 },
      { dimension: "confidenceBand", segmentKey: "0.3-0.5", settled: 100, hits: 20, payoutOddsSum: 108 },
    ], { settled: 500, payoutOddsSum: 500 });
    expect(patterns).toEqual([]);
  });

  it("public projection removes exact segment identity", () => {
    const patterns = mineBuyOutcomePatterns([
      { dimension: "venue", segmentKey: "secret-edge-location", settled: 120, hits: 30, payoutOddsSum: 150 },
    ], { settled: 300, payoutOddsSum: 300 });
    const publicSignals = toPublicOutcomePatternSignals(patterns);
    expect(JSON.stringify(publicSignals)).not.toContain("secret-edge-location");
    expect(publicSignals[0]).toMatchObject({ dimension: "venue", direction: "SUCCESS_EDGE", productionChangeAllowed: false });
  });
});
