import assert from "node:assert/strict";
import test from "node:test";
import { RACER_FEATURE_FEASIBILITY, isRacerSnapshotEligibleForRace } from "./racerDataFeasibility";

test("選手PIT監査matrixは4分類と判定を持つ", () => {
  assert.deepEqual(new Set(RACER_FEATURE_FEASIBILITY.map((row) => row.category)), new Set(["basic", "course", "recent", "interaction"]));
  assert.ok(RACER_FEATURE_FEASIBILITY.length >= 30);
  assert.ok(RACER_FEATURE_FEASIBILITY.some((row) => row.decision === "GO"));
  assert.ok(RACER_FEATURE_FEASIBILITY.some((row) => row.decision === "BLOCKED"));
});

test("対象raceより後に観測・算出したsnapshotを拒否する", () => {
  assert.equal(isRacerSnapshotEligibleForRace({
    raceDate: "2025-01-10",
    targetFeatureCutoffAt: "2025-01-10T06:00:00Z",
    asOfDate: "2025-01-09",
    observedAt: "2025-01-09T12:00:00Z",
    effectiveFrom: "2025-01-01",
    effectiveTo: "2025-06-30",
  }), true);
  assert.equal(isRacerSnapshotEligibleForRace({
    raceDate: "2025-01-10",
    targetFeatureCutoffAt: "2025-01-10T06:00:00Z",
    asOfDate: "2025-01-11",
    observedAt: "2025-01-11T00:00:00Z",
  }), false);
  assert.equal(isRacerSnapshotEligibleForRace({
    raceDate: "2025-01-10",
    targetFeatureCutoffAt: "2025-01-10T06:00:00Z",
    asOfDate: "2025-01-09",
    observedAt: "2025-01-09T12:00:00Z",
    effectiveFrom: "2025-02-01",
  }), false);
  assert.equal(isRacerSnapshotEligibleForRace({
    raceDate: "2025-01-10",
    targetFeatureCutoffAt: "2025-01-10T06:00:00Z",
    asOfDate: "2025-01-10",
    observedAt: "2025-01-10T06:00:01Z",
  }), false);
});
