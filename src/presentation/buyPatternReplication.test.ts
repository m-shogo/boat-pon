import assert from "node:assert/strict";
import test from "node:test";
import { replicateBuyOutcomePatterns } from "./buyPatternReplication";
import type { BuyOutcomePattern } from "./buyOutcomePatternMiner";

function pattern(overrides: Partial<BuyOutcomePattern> = {}): BuyOutcomePattern {
  return {
    dimension: "evBand",
    segmentKey: ">=1.20",
    direction: "FAILURE_REGIME",
    settled: 30,
    hits: 1,
    hitRate: 0.0333,
    roiProxy: 0.2,
    comparisonSettled: 30,
    comparisonRoiProxy: 1.2,
    roiDelta: -1,
    confidence: "WATCH",
    productionChangeAllowed: false,
    ...overrides,
  };
}

test("holds back all signals until two complete non-overlapping windows exist", () => {
  const result = replicateBuyOutcomePatterns({
    totalSettled: 119,
    windowSize: 60,
    discovery: [pattern()],
    confirmation: [pattern()],
  });
  assert.equal(result.status, "INSUFFICIENT_WINDOW_SUPPORT");
  assert.equal(result.requiredSettled, 120);
  assert.equal(result.missingSettledToCompare, 1);
  assert.deepEqual(result.signals, []);
});

test("requires the exact private segment and direction to repeat", () => {
  const result = replicateBuyOutcomePatterns({
    totalSettled: 120,
    windowSize: 60,
    discovery: [pattern()],
    confirmation: [pattern({ segmentKey: "1.10-1.20" })],
  });
  assert.equal(result.status, "NO_REPLICATED_SIGNAL");
  assert.equal(result.discoveryPatternCount, 1);
  assert.equal(result.confirmationPatternCount, 1);
  assert.equal(result.replicatedPatternCount, 0);
  assert.deepEqual(result.signals, []);
});

test("publishes only aggregate identity after same-direction temporal replication", () => {
  const result = replicateBuyOutcomePatterns({
    totalSettled: 140,
    windowSize: 60,
    discovery: [pattern({ roiDelta: -0.8, confidence: "STRONG", settled: 32 })],
    confirmation: [pattern({ roiDelta: -0.35, confidence: "WATCH", settled: 31 })],
  });
  assert.equal(result.status, "REPLICATED_SIGNALS");
  assert.equal(result.replicatedPatternCount, 1);
  assert.deepEqual(result.signals, [{
    id: "PATTERN_FAILURE_REGIME_EVBAND",
    direction: "FAILURE_REGIME",
    dimension: "evBand",
    evidenceCount: 63,
    roiDelta: -0.35,
    confidence: "WATCH",
    productionChangeAllowed: false,
  }]);
  assert.doesNotMatch(JSON.stringify(result.signals), />=1\.20|segmentKey/u);
});

test("opposite-direction observations do not confirm one another", () => {
  const result = replicateBuyOutcomePatterns({
    totalSettled: 120,
    windowSize: 60,
    discovery: [pattern()],
    confirmation: [pattern({ direction: "SUCCESS_EDGE", roiDelta: 0.4 })],
  });
  assert.equal(result.status, "NO_REPLICATED_SIGNAL");
  assert.deepEqual(result.signals, []);
});
