import test from "node:test";
import assert from "node:assert/strict";
import {
  stripLiveOnlyRacerFeatures,
  assertNoLiveOnlyFeaturesForHistorical,
  assertBreakdownNeutralForHistorical,
  classifyProgramFeatureSafety,
  summarizeFeatureSafety,
  LIVE_ONLY_FEATURE_KEYS,
  HISTORICAL_SAFE_FEATURE_KEYS,
} from "./programFeatureSafety";
import { featureAdjustmentBreakdownForSelection } from "./programFeatures";

// ─── stripLiveOnlyRacerFeatures ─────────────────────────────────────────────

test("stripLiveOnlyRacerFeatures: live-only fields become null", () => {
  const snapshot = {
    boats: [
      {
        course: 1,
        className: "A1",
        nationalWinRate: 7.0,
        nationalTop2Rate: 40,
        localWinRate: 6.5,
        localTop2Rate: 38,
        motorTop2Rate: 42,
        boatTop2Rate: 35,
        venueMotorTop2Rate: 44,
        venueBoatTop2Rate: 37,
        // live-only
        courseAvgSt: 0.155,
        courseTop3Rate: 45,
        flyingCount: 2,
        lateStartCount: 1,
        exhibitionStResidual: 0.01,
      },
    ],
  };

  const stripped = stripLiveOnlyRacerFeatures(snapshot);
  const boat = stripped.boats[0];

  // live-only は null になる
  for (const key of LIVE_ONLY_FEATURE_KEYS) {
    assert.equal((boat as Record<string, unknown>)[key], null, `${key} should be null`);
  }

  // historical-safe は維持
  for (const key of HISTORICAL_SAFE_FEATURE_KEYS) {
    const value = (boat as Record<string, unknown>)[key];
    assert.notEqual(value, null, `${key} should not be null`);
    assert.notEqual(value, undefined, `${key} should not be undefined`);
  }
});

test("stripLiveOnlyRacerFeatures: all-null input stays null (no error)", () => {
  const snapshot = { boats: [{ course: 1, className: "B1" }] };
  const stripped = stripLiveOnlyRacerFeatures(snapshot);
  assert.equal(stripped.boats.length, 1);
  assert.equal(stripped.boats[0].courseAvgSt, null);
  assert.equal(stripped.boats[0].flyingCount, null);
});

test("stripLiveOnlyRacerFeatures: does not mutate original", () => {
  const boat = { course: 1, courseAvgSt: 0.15, flyingCount: 3 };
  const snapshot = { boats: [boat] };
  stripLiveOnlyRacerFeatures(snapshot);
  assert.equal(boat.courseAvgSt, 0.15, "original must not be mutated");
  assert.equal(boat.flyingCount, 3, "original must not be mutated");
});

// ─── featureAdjustmentBreakdownForSelection after strip ─────────────────────

test("featureAdjustmentBreakdownForSelection: live-only factors are 1 after strip", () => {
  const snapshot = {
    boats: [
      {
        course: 1,
        className: "A1",
        nationalWinRate: 7.0,
        localWinRate: 6.5,
        motorTop2Rate: 42,
        boatTop2Rate: 35,
        // live-only — historical mode ではstripされる
        courseAvgSt: 0.15,
        courseTop3Rate: 45,
        exhibitionStResidual: 0.02,
      },
    ],
  };

  const stripped = stripLiveOnlyRacerFeatures(snapshot);
  const breakdown = featureAdjustmentBreakdownForSelection(stripped, [1, 2, 3]);

  // live-only系factor はすべて中立
  assert.equal(breakdown.courseStFactor, 1, "courseStFactor must be 1 after strip");
  assert.equal(breakdown.courseTop3Factor, 1, "courseTop3Factor must be 1 after strip");
  assert.equal(breakdown.exhibitionResidualFactor, 1, "exhibitionResidualFactor must be 1 after strip");

  // historical-safe 系 factor は動く
  assert.ok(breakdown.classFactor > 1, "classFactor (A1) should be > 1");
  assert.ok(breakdown.nationalFactor !== 1 || breakdown.localFactor !== 1 || breakdown.motorFactor !== 1, "at least one safe factor should be non-neutral");
});

test("featureAdjustmentBreakdownForSelection: live-only factors are non-1 when not stripped (live mode check)", () => {
  const features = {
    boats: [
      {
        course: 1,
        courseAvgSt: 0.15,
        courseTop3Rate: 45,
        exhibitionStResidual: 0.02,
      },
    ],
  };
  const breakdown = featureAdjustmentBreakdownForSelection(features, [1, 2, 3]);
  // live modeでは non-neutral になる
  assert.ok(breakdown.courseStFactor !== 1 || breakdown.courseTop3Factor !== 1 || breakdown.exhibitionResidualFactor !== 1, "live mode should allow non-neutral live-only factors");
});

// ─── assertNoLiveOnlyFeaturesForHistorical ──────────────────────────────────

test("assertNoLiveOnlyFeaturesForHistorical: throws when courseAvgSt is present", () => {
  const snapshot = {
    boats: [{ course: 1, courseAvgSt: 0.15 }],
  };
  assert.throws(
    () => assertNoLiveOnlyFeaturesForHistorical("race-123", snapshot),
    /historical-backfill cannot use live-only racer snapshots/,
  );
});

test("assertNoLiveOnlyFeaturesForHistorical: throws when flyingCount is present", () => {
  const snapshot = {
    boats: [{ course: 2, flyingCount: 1 }],
  };
  assert.throws(
    () => assertNoLiveOnlyFeaturesForHistorical("race-456", snapshot),
    /flyingCount/,
  );
});

test("assertNoLiveOnlyFeaturesForHistorical: passes when all live-only fields are null", () => {
  const snapshot = {
    boats: [
      {
        course: 1,
        className: "A1",
        nationalWinRate: 7.0,
        courseAvgSt: null,
        courseTop3Rate: null,
        flyingCount: null,
        lateStartCount: null,
        exhibitionStResidual: null,
      },
    ],
  };
  assert.doesNotThrow(() => assertNoLiveOnlyFeaturesForHistorical("race-789", snapshot));
});

test("assertNoLiveOnlyFeaturesForHistorical: passes on empty boats", () => {
  assert.doesNotThrow(() => assertNoLiveOnlyFeaturesForHistorical("race-empty", { boats: [] }));
});

// ─── assertBreakdownNeutralForHistorical ─────────────────────────────────────

test("assertBreakdownNeutralForHistorical: throws when courseStFactor != 1", () => {
  assert.throws(
    () =>
      assertBreakdownNeutralForHistorical("race-x", {
        courseStFactor: 1.02,
        courseTop3Factor: 1,
        exhibitionResidualFactor: 1,
      }),
    /courseStFactor/,
  );
});

test("assertBreakdownNeutralForHistorical: throws when exhibitionResidualFactor != 1", () => {
  assert.throws(
    () =>
      assertBreakdownNeutralForHistorical("race-y", {
        courseStFactor: 1,
        courseTop3Factor: 1,
        exhibitionResidualFactor: 1.01,
      }),
    /exhibitionResidualFactor/,
  );
});

test("assertBreakdownNeutralForHistorical: passes when all are 1", () => {
  assert.doesNotThrow(() =>
    assertBreakdownNeutralForHistorical("race-z", {
      courseStFactor: 1,
      courseTop3Factor: 1,
      exhibitionResidualFactor: 1,
    }),
  );
});

// ─── classifyProgramFeatureSafety ───────────────────────────────────────────

test("classifyProgramFeatureSafety: historical-readonly with live-only fields → not safe", () => {
  const snapshot = {
    boats: [{ course: 1, courseAvgSt: 0.15 }],
  };
  const report = classifyProgramFeatureSafety(snapshot, "historical-readonly");
  assert.equal(report.isHistoricalSafe, false);
  assert.ok(report.warning != null);
  assert.equal(report.liveOnlyNonNullCount, 1);
});

test("classifyProgramFeatureSafety: historical-readonly after strip → safe", () => {
  const snapshot = {
    boats: [{ course: 1, courseAvgSt: 0.15, flyingCount: 2 }],
  };
  const stripped = stripLiveOnlyRacerFeatures(snapshot);
  const report = classifyProgramFeatureSafety(stripped, "historical-readonly");
  assert.equal(report.isHistoricalSafe, true);
  assert.equal(report.warning, null);
  assert.equal(report.liveOnlyNonNullCount, 0);
});

test("classifyProgramFeatureSafety: live mode with live-only fields → safe (by design)", () => {
  const snapshot = {
    boats: [{ course: 1, courseAvgSt: 0.15, flyingCount: 2 }],
  };
  const report = classifyProgramFeatureSafety(snapshot, "live");
  assert.equal(report.isHistoricalSafe, true, "live mode is always considered safe");
  assert.equal(report.warning, null);
});

// ─── summarizeFeatureSafety ──────────────────────────────────────────────────

test("summarizeFeatureSafety: detects leaks across multiple programs", () => {
  const programs = [
    { raceId: "r1", features: { boats: [{ course: 1, courseAvgSt: 0.15 }] } },
    { raceId: "r2", features: { boats: [{ course: 1, className: "A1" }] } },
    { raceId: "r3", features: { boats: [{ course: 1, flyingCount: 1 }] } },
  ];
  const summary = summarizeFeatureSafety(programs, "historical-readonly");
  assert.equal(summary.programsWithLiveOnlyLeak, 2);
  assert.equal(summary.isHistoricalSafe, false);
  assert.ok(summary.warning != null);
});

test("summarizeFeatureSafety: all safe after strip", () => {
  const programs = [
    { raceId: "r1", features: stripLiveOnlyRacerFeatures({ boats: [{ course: 1, courseAvgSt: 0.15 }] }) },
    { raceId: "r2", features: stripLiveOnlyRacerFeatures({ boats: [{ course: 1, flyingCount: 3 }] }) },
  ];
  const summary = summarizeFeatureSafety(programs, "historical-readonly");
  assert.equal(summary.programsWithLiveOnlyLeak, 0);
  assert.equal(summary.isHistoricalSafe, true);
  assert.equal(summary.warning, null);
});
