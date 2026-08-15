import assert from "node:assert/strict";
import test from "node:test";

import {
  scanN2EdgeHypotheses,
  type N2EdgeScanObservation,
} from "./n2EdgeHypothesisScan";

function observation(decisionCutoff: string): N2EdgeScanObservation {
  return {
    canonicalRaceKey: "2020-01-01:01:R1",
    split: "train",
    decisionCutoff,
    betSelection: "1-2-3",
    hit: 1,
    baselineId: "historical-discovery-v1",
    baselineProbability: 0.1,
    features: {},
  };
}

test("edge scan rejects impossible or normalized decision cutoffs instead of silently PIT-excluding features", () => {
  for (const decisionCutoff of [
    "2020-02-30T03:30:00.000Z",
    "2020-01-01T24:00:00.000Z",
    "2020-01-01T03:60:00.000Z",
    "2020-01-01T03:30:60.000Z",
  ]) {
    const report = scanN2EdgeHypotheses([observation(decisionCutoff)]);
    assert.equal(report.status, "BLOCKED", decisionCutoff);
    assert.ok(report.blockers.includes("INVALID_DECISION_CUTOFF"), decisionCutoff);
    assert.equal(report.testedHypothesisCount, 0, decisionCutoff);
    assert.equal(report.signalCount, 0, decisionCutoff);
  }
});

test("edge scan preserves valid leap-day and explicit-offset cutoffs", () => {
  for (const decisionCutoff of [
    "2020-02-29T03:30:00.000Z",
    "2020-01-01T12:30:00+09:00",
  ]) {
    const report = scanN2EdgeHypotheses([observation(decisionCutoff)]);
    assert.equal(report.status, "PASS", decisionCutoff);
    assert.equal(report.blockers.length, 0, decisionCutoff);
  }
});
