import assert from "node:assert/strict";
import test from "node:test";
import { mineBuyOutcomePatterns, toPublicOutcomePatternSignals } from "./buyOutcomePatternMiner";

test("detects repeatable success/failure segments without allowing production changes", () => {
  const patterns = mineBuyOutcomePatterns([
    { dimension: "venue", segmentKey: "private-venue-a", settled: 120, hits: 30, payoutOddsSum: 150 },
    { dimension: "venue", segmentKey: "private-venue-b", settled: 90, hits: 10, payoutOddsSum: 54 },
    { dimension: "evBand", segmentKey: "1.2-1.4", settled: 8, hits: 1, payoutOddsSum: 20 },
  ], { settled: 300, payoutOddsSum: 300 });

  assert.equal(patterns.length, 2);
  assert.equal(patterns[0]?.productionChangeAllowed, false);
  assert.ok(patterns.some((item) => item.direction === "SUCCESS_EDGE"));
  assert.ok(patterns.some((item) => item.direction === "FAILURE_REGIME"));
  assert.ok(patterns.every((item) => item.segmentKey !== "1.2-1.4"));
});

test("does not surface weak or tiny segments", () => {
  const patterns = mineBuyOutcomePatterns([
    { dimension: "sampleBand", segmentKey: "30-99", settled: 29, hits: 5, payoutOddsSum: 5 },
    { dimension: "confidenceBand", segmentKey: "0.3-0.5", settled: 100, hits: 20, payoutOddsSum: 108 },
  ], { settled: 500, payoutOddsSum: 500 });
  assert.deepEqual(patterns, []);
});

test("public projection removes exact segment identity", () => {
  const patterns = mineBuyOutcomePatterns([
    { dimension: "venue", segmentKey: "secret-edge-location", settled: 120, hits: 30, payoutOddsSum: 150 },
  ], { settled: 300, payoutOddsSum: 300 });
  const publicSignals = toPublicOutcomePatternSignals(patterns);
  assert.equal(JSON.stringify(publicSignals).includes("secret-edge-location"), false);
  assert.equal(publicSignals[0]?.dimension, "venue");
  assert.equal(publicSignals[0]?.direction, "SUCCESS_EDGE");
  assert.equal(publicSignals[0]?.productionChangeAllowed, false);
});
