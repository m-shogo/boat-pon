import assert from "node:assert/strict";
import test from "node:test";

import {
  createN2EdgeHypothesisAccumulator,
  scanN2EdgeHypotheses,
  type N2EdgeScanObservation,
} from "./n2EdgeHypothesisScan";

function raceKey(index: number): string {
  const date = new Date("2020-01-01T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + index);
  return `${date.toISOString().slice(0, 10)}:05:R1`;
}

function observation(index: number, selection = "1-2-3"): N2EdgeScanObservation {
  const key = raceKey(index);
  return {
    canonicalRaceKey: key,
    split: "train",
    decisionCutoff: `${key.slice(0, 10)}T03:30:00.000Z`,
    betSelection: selection,
    hit: index % 2 === 0 ? 1 : 0,
    baselineId: "historical-discovery-v1",
    baselineProbability: 0.1,
    features: {
      firstClassName: {
        value: "A1",
        pitClass: "historical_safe",
        availableAt: `${key.slice(0, 10)}T03:00:00.000Z`,
      },
    },
  };
}

function sameDayRace(raceNo: number): N2EdgeScanObservation {
  const row = observation(0);
  return {
    ...row,
    canonicalRaceKey: `2020-01-01:05:R${raceNo}`,
  };
}

test("streaming accumulator matches the array compatibility wrapper", () => {
  const observations = Array.from({ length: 240 }, (_, index) => observation(index));
  const wrapped = scanN2EdgeHypotheses([...observations].reverse());
  const accumulator = createN2EdgeHypothesisAccumulator();
  for (const row of observations) accumulator.add(row);
  const streamed = accumulator.finalize();

  assert.equal(wrapped.status, "PASS");
  assert.equal(streamed.status, "PASS");
  assert.equal(streamed.outputDigest, wrapped.outputDigest);
  assert.deepEqual(streamed.signals, wrapped.signals);
  assert.equal(streamed.testedHypothesisCount, wrapped.testedHypothesisCount);
  assert.equal(streamed.inputObservationCount, 240);
});

test("streaming accumulator rejects true race-order regression", () => {
  const accumulator = createN2EdgeHypothesisAccumulator();
  accumulator.add(observation(1));
  accumulator.add(observation(0));
  const report = accumulator.finalize();
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.some((blocker) => blocker.startsWith("STREAM_ORDER_REGRESSION:")));
  assert.equal(report.signalCount, 0);
});

test("canonical numeric race ordering accepts R9 followed by R10", () => {
  const accumulator = createN2EdgeHypothesisAccumulator();
  accumulator.add(sameDayRace(9));
  accumulator.add(sameDayRace(10));
  const report = accumulator.finalize();
  assert.equal(report.status, "PASS");
  assert.equal(report.inputObservationCount, 2);
  assert.equal(report.blockers.length, 0);
});

test("streaming accumulator rejects duplicate selection row within a race", () => {
  const accumulator = createN2EdgeHypothesisAccumulator();
  accumulator.add(observation(0));
  accumulator.add(observation(0));
  const report = accumulator.finalize();
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes(`DUPLICATE_OBSERVATION:${raceKey(0)}:1-2-3`));
});

test("different selections in the same race count as one unique-race contribution per bucket", () => {
  const observations: N2EdgeScanObservation[] = [];
  for (let index = 0; index < 199; index += 1) {
    observations.push(observation(index, "1-2-3"));
    observations.push(observation(index, "1-2-4"));
  }
  const report = scanN2EdgeHypotheses(observations);
  assert.equal(report.status, "PASS");
  assert.equal(report.testedHypothesisCount, 0);
  assert.equal(report.signalCount, 0);
});

test("large ordered train stream can be consumed without retaining the observation array in the accumulator API", () => {
  const accumulator = createN2EdgeHypothesisAccumulator();
  for (let index = 0; index < 500; index += 1) accumulator.add(observation(index));
  const report = accumulator.finalize();
  assert.equal(report.status, "PASS");
  assert.equal(report.inputObservationCount, 500);
  assert.ok(report.testedHypothesisCount > 0);
  assert.ok(report.signalCount > 0);
});
