import assert from "node:assert/strict";
import test from "node:test";
import { assessBuyOutcomePatternSupport, mineBuyOutcomePatterns, toPublicOutcomePatternSignals } from "./buyOutcomePatternMiner";

test("detects repeatable success/failure segments against the supported complement cohort", () => {
  const patterns = mineBuyOutcomePatterns([
    { dimension: "venue", segmentKey: "private-venue-a", settled: 120, hits: 30, payoutOddsSum: 150 },
    { dimension: "venue", segmentKey: "private-venue-b", settled: 90, hits: 10, payoutOddsSum: 54 },
    { dimension: "evBand", segmentKey: "1.2-1.4", settled: 8, hits: 1, payoutOddsSum: 20 },
  ], { settled: 300, payoutOddsSum: 300 });
  assert.equal(patterns.length, 2);
  const success = patterns.find((item) => item.segmentKey === "private-venue-a");
  const failure = patterns.find((item) => item.segmentKey === "private-venue-b");
  assert.equal(success?.direction, "SUCCESS_EDGE");
  assert.equal(success?.comparisonSettled, 180);
  assert.equal(success?.roiProxy, 1.25);
  assert.equal(success?.comparisonRoiProxy, 0.8333);
  assert.equal(success?.roiDelta, 0.4167);
  assert.equal(success?.confidence, "STRONG");
  assert.equal(failure?.direction, "FAILURE_REGIME");
  assert.equal(failure?.comparisonSettled, 210);
  assert.equal(failure?.roiProxy, 0.6);
  assert.equal(failure?.comparisonRoiProxy, 1.1714);
  assert.equal(failure?.roiDelta, -0.5714);
  assert.equal(failure?.confidence, "WATCH");
  assert.ok(patterns.every((item) => item.productionChangeAllowed === false));
});

test("explains the 58-BUY cohort as complement shortfall", () => {
  const support = assessBuyOutcomePatternSupport([
    { dimension: "venue", segmentKey: "private-a", settled: 30, hits: 2, payoutOddsSum: 40 },
    { dimension: "venue", segmentKey: "private-b", settled: 28, hits: 0, payoutOddsSum: 28 },
    { dimension: "evBand", segmentKey: "private-high-ev", settled: 40, hits: 2, payoutOddsSum: 50 },
  ], { settled: 58, payoutOddsSum: 68 });
  assert.deepEqual(support, {
    status: "INSUFFICIENT_GLOBAL_SUPPORT", baselineSettled: 58, minimumSettledPerSide: 30, minimumTotalSettledForAnyContrast: 60,
    globalAdditionalSettledForAnyContrast: 2, validSegmentCount: 3, segmentSideEligibleCount: 2, universalEligibleSegmentCount: 0,
    closestObservedComplementSettled: 28, minimumObservedComplementShortfall: 2, contrastBlocker: "COMPLEMENT_SUPPORT_SHORTFALL",
    supportedContrastCount: 0, supportedDimensionCount: 0,
  });
});

test("distinguishes universal segment coverage from ordinary complement shortfall", () => {
  const universal = assessBuyOutcomePatternSupport([
    { dimension: "modelVersion", segmentKey: "private-model", settled: 61, hits: 2, payoutOddsSum: 68.3 },
    { dimension: "evBand", segmentKey: "private-ev", settled: 61, hits: 2, payoutOddsSum: 68.3 },
  ], { settled: 61, payoutOddsSum: 68.3 });
  assert.equal(universal.status, "NO_SUPPORTED_CONTRAST");
  assert.equal(universal.segmentSideEligibleCount, 2);
  assert.equal(universal.universalEligibleSegmentCount, 2);
  assert.equal(universal.closestObservedComplementSettled, 0);
  assert.equal(universal.minimumObservedComplementShortfall, 30);
  assert.equal(universal.contrastBlocker, "UNIVERSAL_SEGMENT_COVERAGE");

  const shortfall = assessBuyOutcomePatternSupport([
    { dimension: "venue", segmentKey: "dominant", settled: 50, hits: 2, payoutOddsSum: 60 },
    { dimension: "venue", segmentKey: "thin", settled: 20, hits: 0, payoutOddsSum: 10 },
  ], { settled: 70, payoutOddsSum: 70 });
  assert.equal(shortfall.status, "NO_SUPPORTED_CONTRAST");
  assert.equal(shortfall.universalEligibleSegmentCount, 0);
  assert.equal(shortfall.closestObservedComplementSettled, 20);
  assert.equal(shortfall.minimumObservedComplementShortfall, 10);
  assert.equal(shortfall.contrastBlocker, "COMPLEMENT_SUPPORT_SHORTFALL");
});

test("supported contrasts have no blocker", () => {
  const supported = assessBuyOutcomePatternSupport([
    { dimension: "venue", segmentKey: "a", settled: 35, hits: 2, payoutOddsSum: 45 },
    { dimension: "venue", segmentKey: "b", settled: 35, hits: 0, payoutOddsSum: 25 },
    { dimension: "evBand", segmentKey: "high", settled: 30, hits: 1, payoutOddsSum: 35 },
    { dimension: "evBand", segmentKey: "low", settled: 40, hits: 1, payoutOddsSum: 35 },
  ], { settled: 70, payoutOddsSum: 70 });
  assert.equal(supported.status, "SUPPORTED_CONTRASTS");
  assert.equal(supported.closestObservedComplementSettled, 40);
  assert.equal(supported.minimumObservedComplementShortfall, 0);
  assert.equal(supported.contrastBlocker, null);
  assert.equal(supported.supportedContrastCount, 4);
  assert.equal(supported.supportedDimensionCount, 2);
});

test("returns no-eligible blocker when no segment side has enough evidence", () => {
  const support = assessBuyOutcomePatternSupport([
    { dimension: "venue", segmentKey: "a", settled: 20, hits: 1, payoutOddsSum: 20 },
    { dimension: "venue", segmentKey: "b", settled: 20, hits: 1, payoutOddsSum: 20 },
  ], { settled: 70, payoutOddsSum: 70 });
  assert.equal(support.segmentSideEligibleCount, 0);
  assert.equal(support.universalEligibleSegmentCount, 0);
  assert.equal(support.closestObservedComplementSettled, null);
  assert.equal(support.minimumObservedComplementShortfall, null);
  assert.equal(support.contrastBlocker, "NO_ELIGIBLE_SEGMENT");
});

test("does not count invalid or impossible segment aggregates as support", () => {
  const support = assessBuyOutcomePatternSupport([
    { dimension: "venue", segmentKey: "", settled: 30, hits: 2, payoutOddsSum: 10 },
    { dimension: "venue", segmentKey: "too-many", settled: 80, hits: 2, payoutOddsSum: 10 },
    { dimension: "evBand", segmentKey: "too-much-payout", settled: 30, hits: 2, payoutOddsSum: 200 },
  ], { settled: 70, payoutOddsSum: 100 });
  assert.equal(support.validSegmentCount, 0);
  assert.equal(support.contrastBlocker, "NO_ELIGIBLE_SEGMENT");
  assert.equal(support.supportedContrastCount, 0);
});

test("does not surface weak, tiny, or unsupported-complement segments", () => {
  assert.deepEqual(mineBuyOutcomePatterns([
    { dimension: "sampleBand", segmentKey: "30-99", settled: 29, hits: 5, payoutOddsSum: 5 },
    { dimension: "confidenceBand", segmentKey: "0.3-0.5", settled: 100, hits: 20, payoutOddsSum: 108 },
  ], { settled: 500, payoutOddsSum: 500 }), []);
  assert.deepEqual(mineBuyOutcomePatterns([
    { dimension: "venue", segmentKey: "premature-edge", settled: 30, hits: 10, payoutOddsSum: 60 },
  ], { settled: 58, payoutOddsSum: 68.3 }, { minSettled: 30, minRoiDelta: 0.15 }), []);
});

test("comparison support can be stricter and impossible aggregates do not manufacture complements", () => {
  assert.deepEqual(mineBuyOutcomePatterns([
    { dimension: "venue", segmentKey: "candidate", settled: 60, hits: 12, payoutOddsSum: 90 },
  ], { settled: 130, payoutOddsSum: 120 }, { minSettled: 30, minComparisonSettled: 80, minRoiDelta: 0.15 }), []);
  assert.deepEqual(mineBuyOutcomePatterns([
    { dimension: "venue", segmentKey: "impossible", settled: 80, hits: 20, payoutOddsSum: 120 },
  ], { settled: 60, payoutOddsSum: 100 }), []);
});

test("public projection removes exact segment and complement identity", () => {
  const patterns = mineBuyOutcomePatterns([
    { dimension: "venue", segmentKey: "secret-edge-location", settled: 120, hits: 30, payoutOddsSum: 150 },
  ], { settled: 300, payoutOddsSum: 300 });
  const publicSignals = toPublicOutcomePatternSignals(patterns);
  const serialized = JSON.stringify(publicSignals);
  assert.equal(serialized.includes("secret-edge-location"), false);
  assert.equal(serialized.includes("comparisonSettled"), false);
  assert.equal(serialized.includes("comparisonRoiProxy"), false);
  assert.equal(publicSignals[0]?.dimension, "venue");
  assert.equal(publicSignals[0]?.productionChangeAllowed, false);
});
