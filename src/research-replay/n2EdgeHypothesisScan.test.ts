import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_EDGE_FEATURE_DEFINITIONS,
  N2_EDGE_SCAN_MIN_UNIQUE_RACES,
  scanN2EdgeHypotheses,
  type N2EdgeScanObservation,
} from "./n2EdgeHypothesisScan";

const LIVE_ONLY_KEYS = [
  "courseAvgSt",
  "courseTop3Rate",
  "courseEntryRate",
  "courseStartOrder",
  "flyingCount",
  "lateStartCount",
  "exhibitionStResidual",
];

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

function trainObservation(index: number, overrides: Partial<N2EdgeScanObservation> = {}): N2EdgeScanObservation {
  const date = dateFor(index);
  return {
    canonicalRaceKey: raceKey(index),
    split: "train",
    decisionCutoff: `${date}T03:30:00.000Z`,
    betSelection: "1-2-3",
    hit: index % 2 === 0 ? 1 : 0,
    baselineId: "historical-discovery-v1",
    baselineProbability: 0.1,
    features: {},
    ...overrides,
  };
}

test("feature registry has explicit selection roles, correct percent units, and no current snapshot leakage keys", () => {
  const families = new Set(N2_EDGE_FEATURE_DEFINITIONS.map((definition) => definition.family));
  assert.deepEqual(
    [...families].sort(),
    ["course", "exhibition", "motor_boat", "player", "start_timing", "weather"],
  );

  const featureKeys = new Set(N2_EDGE_FEATURE_DEFINITIONS.map((definition) => definition.featureKey));
  for (const key of LIVE_ONLY_KEYS) assert.equal(featureKeys.has(key), false, `${key} must stay outside N2 scan v1`);
  for (const key of ["firstCourse", "secondCourse", "thirdCourse"]) {
    const definition = N2_EDGE_FEATURE_DEFINITIONS.find((candidate) => candidate.featureKey === key);
    assert.ok(definition);
    assert.equal(definition.sourceStatus, "derived_from_selection");
  }
  for (const key of ["firstStartTiming", "secondExhibitionRank", "windSpeedMps", "waveHeightCm"]) {
    const definition = N2_EDGE_FEATURE_DEFINITIONS.find((candidate) => candidate.featureKey === key);
    assert.ok(definition, `${key} must be represented in the frozen research space`);
    assert.equal(definition.sourceStatus, "requires_verified_timed_adapter");
  }
  const motor = N2_EDGE_FEATURE_DEFINITIONS.find((candidate) => candidate.featureKey === "firstMotorTop2Rate");
  assert.deepEqual(motor?.cutPoints, [30, 40, 50]);
});

test("scanner blocks validation/test/forward labels from discovery", () => {
  const validationDate = "2022-01-01";
  const report = scanN2EdgeHypotheses([
    trainObservation(0),
    trainObservation(1, {
      canonicalRaceKey: `${validationDate}:01:R1`,
      split: "validation",
      decisionCutoff: `${validationDate}T03:30:00.000Z`,
    }),
  ]);
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("NON_DISCOVERY_SPLIT_PRESENT:validation"));
  assert.equal(report.signalCount, 0);
  assert.equal(report.authority.validationLabelsUsedForDiscovery, false);
});

test("scanner recomputes canonical split instead of trusting a caller-supplied train label", () => {
  const date = "2026-08-08";
  const report = scanN2EdgeHypotheses([
    trainObservation(0, {
      canonicalRaceKey: `${date}:01:R1`,
      split: "train",
      decisionCutoff: `${date}T03:30:00.000Z`,
    }),
  ]);
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.some((blocker) => blocker.startsWith("SPLIT_MISMATCH:")));
});

test("unknown current-snapshot feature injection fails closed", () => {
  const observation = trainObservation(0);
  observation.features.courseAvgSt = {
    value: 0.12,
    pitClass: "live_only",
    availableAt: "2020-01-01T03:00:00.000Z",
  };
  const report = scanN2EdgeHypotheses([observation]);
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("UNKNOWN_FEATURE_KEY:courseAvgSt"));
});

test("future feature availability is excluded before that feature can generate a hypothesis", () => {
  const observations = Array.from({ length: N2_EDGE_SCAN_MIN_UNIQUE_RACES }, (_, index) => {
    const observation = trainObservation(index);
    observation.features.firstClassName = {
      value: "A1",
      pitClass: "historical_safe",
      availableAt: `${dateFor(index)}T04:00:00.000Z`,
    };
    return observation;
  });
  const report = scanN2EdgeHypotheses(observations);
  assert.equal(report.status, "PASS");
  assert.equal(report.pitExcludedFeatureValueCount, observations.length);
  assert.equal(report.signals.some((signal) => signal.featureKey === "firstClassName"), false);
});

test("ST/exhibition/weather stay adapter-gated even when their timestamp looks pre-cutoff", () => {
  const observations = Array.from({ length: N2_EDGE_SCAN_MIN_UNIQUE_RACES }, (_, index) => {
    const observation = trainObservation(index);
    observation.features.firstStartTiming = {
      value: 0.05,
      pitClass: "historical_safe",
      availableAt: `${dateFor(index)}T03:00:00.000Z`,
      adapterVerified: false,
      adapterId: "unverified-test-adapter",
    };
    return observation;
  });
  const report = scanN2EdgeHypotheses(observations);
  assert.equal(report.status, "PASS");
  assert.equal(report.adapterGatedFeatureValueCount, observations.length);
  assert.equal(report.signals.some((signal) => signal.featureKey === "firstStartTiming"), false);
});

test("verified pre-cutoff timed adapter may participate in the frozen univariate scan", () => {
  const observations = Array.from({ length: N2_EDGE_SCAN_MIN_UNIQUE_RACES }, (_, index) => {
    const observation = trainObservation(index);
    observation.features.firstStartTiming = {
      value: 0.05,
      pitClass: "historical_safe",
      availableAt: `${dateFor(index)}T03:00:00.000Z`,
      adapterVerified: true,
      adapterId: "fixture-start-timing-v1",
    };
    return observation;
  });
  const report = scanN2EdgeHypotheses(observations);
  assert.equal(report.status, "PASS");
  assert.equal(report.adapterGatedFeatureValueCount, 0);
  assert.ok(report.signals.some((signal) => signal.featureKey === "firstStartTiming"));
});

test("strong train-only residual survives race-level support and Holm correction", () => {
  const observations = Array.from({ length: 240 }, (_, index) => trainObservation(index));
  const report = scanN2EdgeHypotheses(observations);
  assert.equal(report.status, "PASS");
  assert.equal(report.baselineId, "historical-discovery-v1");
  assert.equal(report.multipleTesting.method, "Holm-Bonferroni");
  const signal = report.signals.find((candidate) => candidate.featureKey === "firstCourse" && candidate.bucket === "1");
  assert.ok(signal);
  assert.equal(signal.selectionRole, "first");
  assert.equal(signal.uniqueRaceCount, 240);
  assert.equal(signal.direction, "underpredicted");
  assert.ok(signal.holmAdjustedPValue <= 0.05);
  assert.ok(signal.meanResidual > 0.3);
  assert.deepEqual(signal.confirmationSplits, ["validation", "test"]);
  assert.equal(signal.forwardShadowReserved, true);
});

test("selection-row duplication cannot substitute for the minimum unique-race support", () => {
  const observations: N2EdgeScanObservation[] = [];
  for (let index = 0; index < N2_EDGE_SCAN_MIN_UNIQUE_RACES - 1; index += 1) {
    observations.push(trainObservation(index));
    observations.push(trainObservation(index, { betSelection: "1-2-4" }));
  }
  const report = scanN2EdgeHypotheses(observations);
  assert.equal(report.status, "PASS");
  assert.equal(report.testedHypothesisCount, 0);
  assert.equal(report.signalCount, 0);
});

test("scan output is deterministic and carries no raw rows or product authority", () => {
  const observations = Array.from({ length: 220 }, (_, index) => trainObservation(index));
  const first = scanN2EdgeHypotheses(observations);
  const second = scanN2EdgeHypotheses([...observations].reverse());
  assert.equal(first.outputDigest, second.outputDigest);
  assert.deepEqual(first.signals, second.signals);
  assert.equal(first.interactionScanAllowed, false);
  assert.equal(first.authority.roiUsedForDiscovery, false);
  assert.equal(first.authority.payoutUsedForDiscovery, false);
  assert.equal(first.authority.testLabelsUsedForDiscovery, false);
  assert.equal(first.authority.forwardLabelsUsedForDiscovery, false);
  assert.equal(first.authority.automaticPromotionAuthorized, false);
  assert.equal(first.authority.currentBuyConnectionAuthorized, false);
  assert.equal(first.authority.lineConnectionAuthorized, false);
  assert.equal(first.authority.publicPublishAuthorized, false);
  assert.equal(first.authority.automatedBettingAuthorized, false);
  assert.equal(first.authority.productionApplyAuthorized, false);
  assert.doesNotMatch(JSON.stringify(first), /2020-\d{2}-\d{2}:\d{2}:R\d+/u);
});
