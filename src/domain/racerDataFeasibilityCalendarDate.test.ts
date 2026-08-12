import assert from "node:assert/strict";
import test from "node:test";
import { isRacerSnapshotEligibleForRace } from "./racerDataFeasibility";

const validBase = {
  raceDate: "2028-02-29",
  targetFeatureCutoffAt: "2028-02-29T12:00:00Z",
  asOfDate: "2028-02-29",
  observedAt: "2028-02-29T11:00:00Z",
};

test("racer snapshot eligibility accepts a real leap-day date", () => {
  assert.equal(isRacerSnapshotEligibleForRace(validBase), true);
});

test("racer snapshot eligibility rejects impossible calendar dates", () => {
  for (const impossible of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01"]) {
    assert.equal(isRacerSnapshotEligibleForRace({ ...validBase, raceDate: impossible, targetFeatureCutoffAt: `${impossible}T12:00:00Z` }), false);
    assert.equal(isRacerSnapshotEligibleForRace({ ...validBase, asOfDate: impossible }), false);
    assert.equal(isRacerSnapshotEligibleForRace({ ...validBase, observedAt: `${impossible}T11:00:00Z` }), false);
    assert.equal(isRacerSnapshotEligibleForRace({ ...validBase, effectiveFrom: impossible }), false);
    assert.equal(isRacerSnapshotEligibleForRace({ ...validBase, effectiveTo: impossible }), false);
  }
});
