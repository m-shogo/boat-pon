import assert from "node:assert/strict";
import test from "node:test";

import { scanN2EdgeHypotheses, type N2EdgeScanObservation } from "./n2EdgeHypothesisScan";

function observation(baselineId: string): N2EdgeScanObservation {
  return {
    canonicalRaceKey: "2020-01-01:01:R1",
    split: "train",
    decisionCutoff: "2020-01-01T03:30:00.000Z",
    betSelection: "1-2-3",
    hit: 1,
    baselineId,
    baselineProbability: 0.1,
    features: {},
  };
}

test("edge hypothesis scan rejects blank or padded baseline authority ids", () => {
  for (const baselineId of ["", "   ", " historical-discovery-v1 "]) {
    const report = scanN2EdgeHypotheses([observation(baselineId)]);
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.baselineId, null);
    assert.ok(report.blockers.includes("INVALID_BASELINE_ID"));
    assert.equal(report.signalCount, 0);
  }
});
