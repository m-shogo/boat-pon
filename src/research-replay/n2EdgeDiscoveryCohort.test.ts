import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_EDGE_DISCOVERY_MAX_RACES,
  N2_EDGE_DISCOVERY_MAX_SELECTION_ROWS,
  N2_EDGE_DISCOVERY_RACES_PER_VENUE_YEAR,
  buildN2EdgeDiscoveryCohort,
} from "./n2EdgeDiscoveryCohort";

function raceKeysForStratum(year: number, venueCode: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const dayOffset = Math.floor(index / 12);
    const raceNo = (index % 12) + 1;
    const date = new Date(`${year}-01-01T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + dayOffset);
    return `${date.toISOString().slice(0, 10)}:${venueCode}:R${raceNo}`;
  });
}

test("cohort caps each venue-year stratum at 12 races with outcome-independent deterministic ranking", () => {
  const candidates = [
    ...raceKeysForStratum(2020, "05", 30),
    ...raceKeysForStratum(2020, "06", 5),
    ...raceKeysForStratum(2021, "05", 20),
  ].map((canonicalRaceKey) => ({ canonicalRaceKey }));
  const report = buildN2EdgeDiscoveryCohort(candidates);
  assert.equal(report.status, "PASS");
  assert.equal(report.selectedByStratum["2020:05"], 12);
  assert.equal(report.selectedByStratum["2020:06"], 5);
  assert.equal(report.selectedByStratum["2021:05"], 12);
  assert.equal(report.selectedRaceCount, 29);
  assert.equal(report.selectedSelectionRowCount, 29 * 120);
  assert.equal(report.representedYearCount, 2);
  assert.equal(report.representedVenueCount, 2);
  assert.equal(report.policy.outcomeDependentSamplingAllowed, false);
  assert.equal(report.policy.labelDependentSamplingAllowed, false);
  assert.equal(report.policy.featureDependentSamplingAllowed, false);
  assert.equal(report.policy.payoutDependentSamplingAllowed, false);
});

test("input order cannot change the selected cohort", () => {
  const candidates = [
    ...raceKeysForStratum(2019, "01", 24),
    ...raceKeysForStratum(2020, "02", 24),
  ].map((canonicalRaceKey) => ({ canonicalRaceKey }));
  const first = buildN2EdgeDiscoveryCohort(candidates);
  const second = buildN2EdgeDiscoveryCohort([...candidates].reverse());
  assert.equal(first.status, "PASS");
  assert.equal(first.cohortDigest, second.cohortDigest);
  assert.equal(first.outputDigest, second.outputDigest);
  assert.deepEqual(first.races, second.races);
});

test("selected races use canonical numeric race order so R9 precedes R10", () => {
  const candidates = raceKeysForStratum(2020, "01", 12)
    .map((canonicalRaceKey) => ({ canonicalRaceKey }));
  const report = buildN2EdgeDiscoveryCohort(candidates);
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.races.map((race) => race.canonicalRaceKey), [
    "2020-01-01:01:R1",
    "2020-01-01:01:R2",
    "2020-01-01:01:R3",
    "2020-01-01:01:R4",
    "2020-01-01:01:R5",
    "2020-01-01:01:R6",
    "2020-01-01:01:R7",
    "2020-01-01:01:R8",
    "2020-01-01:01:R9",
    "2020-01-01:01:R10",
    "2020-01-01:01:R11",
    "2020-01-01:01:R12",
  ]);
});

test("2001-2003 coverage gap and post-train dates are excluded before sampling", () => {
  const candidates = [
    { canonicalRaceKey: "2003-12-31:01:R1" },
    { canonicalRaceKey: "2004-01-01:01:R1" },
    { canonicalRaceKey: "2021-12-31:01:R1" },
    { canonicalRaceKey: "2022-01-01:01:R1" },
    { canonicalRaceKey: "2026-08-08:01:R1" },
  ];
  const report = buildN2EdgeDiscoveryCohort(candidates);
  assert.equal(report.status, "PASS");
  assert.equal(report.excludedBefore2004Count, 1);
  assert.equal(report.excludedAfterTrainCount, 2);
  assert.equal(report.eligibleRaceCount, 2);
  assert.deepEqual(report.races.map((race) => race.canonicalRaceKey), [
    "2004-01-01:01:R1",
    "2021-12-31:01:R1",
  ]);
});

test("duplicate or invalid race keys fail closed rather than silently deduplicating", () => {
  const duplicate = buildN2EdgeDiscoveryCohort([
    { canonicalRaceKey: "2020-01-01:01:R1" },
    { canonicalRaceKey: "2020-01-01:01:R1" },
  ]);
  assert.equal(duplicate.status, "BLOCKED");
  assert.ok(duplicate.blockers.includes("DUPLICATE_RACE_KEYS:1"));
  assert.equal(duplicate.selectedRaceCount, 0);

  const invalid = buildN2EdgeDiscoveryCohort([{ canonicalRaceKey: "not-a-race" }]);
  assert.equal(invalid.status, "BLOCKED");
  assert.ok(invalid.blockers.includes("INVALID_RACE_KEYS:1"));
  assert.equal(invalid.selectedRaceCount, 0);
});

test("full policy has a hard upper bound of 5,184 races / 622,080 selection rows", () => {
  assert.equal(N2_EDGE_DISCOVERY_RACES_PER_VENUE_YEAR, 12);
  assert.equal(N2_EDGE_DISCOVERY_MAX_RACES, 5184);
  assert.equal(N2_EDGE_DISCOVERY_MAX_SELECTION_ROWS, 622080);
});
