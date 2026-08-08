import assert from "node:assert/strict";
import test from "node:test";

import type { ProgramFeatureSnapshot } from "../domain/programFeatures";
import {
  N2_EDGE_PROGRAM_AVAILABILITY_ADAPTER_ID,
  adaptN2HistoricalProgramFeatures,
} from "./n2EdgeHistoricalProgramFeatureAdapter";

function programFeatures(): ProgramFeatureSnapshot {
  return {
    boats: Array.from({ length: 6 }, (_, index) => {
      const course = index + 1;
      return {
        course,
        registrationNo: `R${course}`,
        racerName: `Racer ${course}`,
        className: course === 1 ? "A1" : course === 3 ? "A2" : "B1",
        nationalWinRate: 4.5 + course / 2,
        nationalTop2Rate: 30 + course * 3,
        localWinRate: 4 + course / 2,
        localTop2Rate: 28 + course * 4,
        motorNo: String(10 + course),
        motorTop2Rate: 32 + course,
        boatNo: String(20 + course),
        boatTop2Rate: 33 + course,
        venueMotorTop2Rate: 34 + course,
        venueBoatTop2Rate: 35 + course,
        courseAvgSt: null,
        courseTop3Rate: null,
        flyingCount: null,
        lateStartCount: null,
        exhibitionStResidual: null,
      };
    }),
  };
}

const cutoff = "2020-01-01T03:30:00.000Z";

test("adapter maps official-program safe fields by explicit first/second/third selection role", () => {
  const report = adaptN2HistoricalProgramFeatures({
    betSelection: "1-3-5",
    decisionCutoff: cutoff,
    featureMode: "historical-readonly",
    programFeatures: programFeatures(),
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.selectedBoatCount, 3);
  assert.equal(report.mappedFeatureCount, 27);
  assert.equal(report.nullFeatureCount, 0);
  assert.equal(report.features.firstClassName.value, "A1");
  assert.equal(report.features.secondClassName.value, "A2");
  assert.equal(report.features.thirdNationalWinRate.value, 7);
  assert.equal(report.features.firstMotorTop2Rate.value, 33);
  assert.equal(report.features.secondVenueBoatTop2Rate.value, 38);
  assert.equal(report.features.thirdLocalTop2Rate.value, 48);
  for (const feature of Object.values(report.features)) {
    assert.equal(feature.pitClass, "historical_safe");
    assert.equal(feature.availableAt, cutoff);
    assert.equal(feature.adapterId, N2_EDGE_PROGRAM_AVAILABILITY_ADAPTER_ID);
    assert.equal(feature.adapterVerified, true);
  }
  assert.equal(report.sourceEvidence.currentSnapshotFallbackAuthorized, false);
  assert.equal(report.sourceEvidence.racerProfilesReadAuthorized, false);
  assert.equal(report.sourceEvidence.racerCourseStatsReadAuthorized, false);
  assert.equal(report.sourceEvidence.exhibitionResidualReadAuthorized, false);
  assert.equal(report.sourceEvidence.databaseWriteAuthorized, false);
});

test("adapter never exposes identity fields or timed ST/exhibition/weather fields", () => {
  const report = adaptN2HistoricalProgramFeatures({
    betSelection: "1-2-3",
    decisionCutoff: cutoff,
    featureMode: "historical-readonly",
    programFeatures: programFeatures(),
  });
  assert.equal(report.status, "PASS");
  const serialized = JSON.stringify(report.features);
  assert.doesNotMatch(serialized, /registrationNo|racerName|motorNo|boatNo/u);
  assert.equal(Object.hasOwn(report.features, "firstStartTiming"), false);
  assert.equal(Object.hasOwn(report.features, "firstExhibitionRank"), false);
  assert.equal(Object.hasOwn(report.features, "windSpeedMps"), false);
  assert.equal(Object.hasOwn(report.features, "waveHeightCm"), false);
});

test("live-only current snapshot values block the entire adaptation", () => {
  const features = programFeatures();
  features.boats[0].courseAvgSt = 0.12;
  const report = adaptN2HistoricalProgramFeatures({
    betSelection: "1-2-3",
    decisionCutoff: cutoff,
    featureMode: "historical-readonly",
    programFeatures: features,
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.some((blocker) => blocker.startsWith("LIVE_ONLY_FEATURE_PRESENT:")));
  assert.deepEqual(report.features, {});
});

test("adapter refuses non-readonly feature modes even when the snapshot itself looks safe", () => {
  const report = adaptN2HistoricalProgramFeatures({
    betSelection: "1-2-3",
    decisionCutoff: cutoff,
    featureMode: "historical",
    programFeatures: programFeatures(),
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("FEATURE_MODE_NOT_READONLY:historical"));
});

test("missing selected boat fails closed instead of silently dropping its role", () => {
  const features = programFeatures();
  features.boats = features.boats.filter((boat) => boat.course !== 3);
  const report = adaptN2HistoricalProgramFeatures({
    betSelection: "1-3-5",
    decisionCutoff: cutoff,
    featureMode: "historical-readonly",
    programFeatures: features,
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("SELECTED_BOAT_MISSING:second:3"));
  assert.equal(report.mappedFeatureCount, 0);
});

test("missing individual safe values remain null and are never imputed", () => {
  const features = programFeatures();
  features.boats[0].localWinRate = null;
  features.boats[0].venueBoatTop2Rate = null;
  const report = adaptN2HistoricalProgramFeatures({
    betSelection: "1-2-3",
    decisionCutoff: cutoff,
    featureMode: "historical-readonly",
    programFeatures: features,
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.features.firstLocalWinRate.value, null);
  assert.equal(report.features.firstVenueBoatTop2Rate.value, null);
  assert.equal(report.nullFeatureCount, 2);
});

test("invalid selection and cutoff fail closed before any mapped features are emitted", () => {
  const report = adaptN2HistoricalProgramFeatures({
    betSelection: "1-1-2",
    decisionCutoff: "not-a-time",
    featureMode: "historical-readonly",
    programFeatures: programFeatures(),
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("INVALID_TRIFECTA_SELECTION:1-1-2"));
  assert.ok(report.blockers.includes("INVALID_DECISION_CUTOFF"));
  assert.deepEqual(report.features, {});
});

test("adapter output is deterministic", () => {
  const input = {
    betSelection: "1-3-5",
    decisionCutoff: cutoff,
    featureMode: "historical-readonly" as const,
    programFeatures: programFeatures(),
  };
  const first = adaptN2HistoricalProgramFeatures(input);
  const second = adaptN2HistoricalProgramFeatures(input);
  assert.equal(first.outputDigest, second.outputDigest);
  assert.deepEqual(first.features, second.features);
});
