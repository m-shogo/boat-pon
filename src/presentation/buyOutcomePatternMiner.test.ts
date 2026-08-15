import assert from "node:assert/strict";
import test from "node:test";
import { mineBuyOutcomePatterns, toPublicOutcomePatternSignals } from "./buyOutcomePatternMiner";

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
  assert.ok(patterns.every((item) => item.segmentKey !== "1.2-1.4"));
});

test("does not surface weak or tiny segments", () => {
  const patterns = mineBuyOutcomePatterns([
    { dimension: "sampleBand", segmentKey: "30-99", settled: 29, hits: 5, payoutOddsSum: 5 },
    { dimension: "confidenceBand", segmentKey: "0.3-0.5", settled: 100, hits: 20, payoutOddsSum: 108 },
  ], { settled: 500, payoutOddsSum: 500 });
  assert.deepEqual(patterns, []);
});

test("does not surface a segment when the rest of the cohort is under-supported", () => {
  const patterns = mineBuyOutcomePatterns([
    { dimension: "venue", segmentKey: "premature-edge", settled: 30, hits: 10, payoutOddsSum: 90 },
  ], { settled: 58, payoutOddsSum: 68.3 }, {
    minSettled: 30,
    minRoiDelta: 0.15,
  });
  assert.deepEqual(patterns, []);
});

test("comparison support can be made stricter without changing production behavior", () => {
  const patterns = mineBuyOutcomePatterns([
    { dimension: "venue", segmentKey: "candidate", settled: 60, hits: 12, payoutOddsSum: 90 },
  ], { settled: 130, payoutOddsSum: 120 }, {
    minSettled: 30,
    minComparisonSettled: 80,
    minRoiDelta: 0.15,
  });
  assert.deepEqual(patterns, []);
});

test("rejects inconsistent aggregate inputs instead of manufacturing a complement", () => {
  const patterns = mineBuyOutcomePatterns([
    { dimension: "venue", segmentKey: "impossible", settled: 80, hits: 20, payoutOddsSum: 120 },
  ], { settled: 60, payoutOddsSum: 100 });
  assert.deepEqual(patterns, []);
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
  assert.equal(publicSignals[0]?.direction, "SUCCESS_EDGE");
  assert.equal(publicSignals[0]?.productionChangeAllowed, false);
});
