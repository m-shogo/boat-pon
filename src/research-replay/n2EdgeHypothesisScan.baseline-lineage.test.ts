import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_EDGE_SCAN_MIN_UNIQUE_RACES,
  scanN2EdgeHypotheses,
  type N2EdgeScanObservation,
} from "./n2EdgeHypothesisScan";

function dateFor(index: number): string {
  const value = new Date("2020-01-01T00:00:00.000Z");
  value.setUTCDate(value.getUTCDate() + Math.floor(index / (24 * 12)));
  return value.toISOString().slice(0, 10);
}

function raceKey(index: number): string {
  const venue = (Math.floor(index / 12) % 24) + 1;
  const raceNo = (index % 12) + 1;
  return `${dateFor(index)}:${String(venue).padStart(2, "0")}:R${raceNo}`;
}

function observation(index: number, baselineId: string): N2EdgeScanObservation {
  const date = dateFor(index);
  return {
    canonicalRaceKey: raceKey(index),
    split: "train",
    decisionCutoff: `${date}T03:30:00.000Z`,
    betSelection: "1-2-3",
    hit: index % 2 === 0 ? 1 : 0,
    baselineId,
    baselineProbability: 0.1,
    features: {},
  };
}

test("hypothesis ids are scoped to the baseline lineage that produced them", () => {
  const baselineA = Array.from(
    { length: N2_EDGE_SCAN_MIN_UNIQUE_RACES + 20 },
    (_, index) => observation(index, "historical-discovery-v1"),
  );
  const baselineB = baselineA.map((item) => ({
    ...item,
    baselineId: "historical-discovery-v2",
  }));

  const first = scanN2EdgeHypotheses(baselineA);
  const second = scanN2EdgeHypotheses(baselineB);

  assert.equal(first.status, "PASS");
  assert.equal(second.status, "PASS");
  assert.equal(first.baselineId, "historical-discovery-v1");
  assert.equal(second.baselineId, "historical-discovery-v2");

  const firstSignal = first.signals.find(
    (candidate) => candidate.featureKey === "firstCourse" && candidate.bucket === "1",
  );
  const secondSignal = second.signals.find(
    (candidate) => candidate.featureKey === "firstCourse" && candidate.bucket === "1",
  );

  assert.ok(firstSignal);
  assert.ok(secondSignal);
  assert.equal(firstSignal.featureKey, secondSignal.featureKey);
  assert.equal(firstSignal.bucket, secondSignal.bucket);
  assert.equal(firstSignal.direction, secondSignal.direction);
  assert.notEqual(firstSignal.hypothesisId, secondSignal.hypothesisId);
});
