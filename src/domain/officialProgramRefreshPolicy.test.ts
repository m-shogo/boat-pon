import assert from "node:assert/strict";
import test from "node:test";

import {
  parseForcedProgramRefreshDates,
  shouldSkipOfficialProgramDate,
  summarizeOfficialProgramDayInventory,
} from "./officialProgramRefreshPolicy.js";

test("forced refresh dates bypass skip-existing without widening other dates", () => {
  const existing = new Set(["2026-08-06", "2026-08-07"]);
  const forced = parseForcedProgramRefreshDates("2026-08-07, invalid, 2026-08-07");
  assert.deepEqual([...forced], ["2026-08-07"]);
  assert.equal(shouldSkipOfficialProgramDate({
    date: "2026-08-06",
    skipExisting: true,
    existingDates: existing,
    forcedRefreshDates: forced,
  }), true);
  assert.equal(shouldSkipOfficialProgramDate({
    date: "2026-08-07",
    skipExisting: true,
    existingDates: existing,
    forcedRefreshDates: forced,
  }), false);
});

test("complete venue inventory requires race numbers 1 through 12", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    date: "2026-08-07",
    venue: "三国",
    raceNo: index + 1,
  }));
  assert.deepEqual(summarizeOfficialProgramDayInventory("2026-08-07", rows), {
    date: "2026-08-07",
    totalRows: 12,
    venueCount: 1,
    completeVenueCount: 1,
    incompleteVenues: [],
    structurallyComplete: true,
  });
});

test("partial venues remain explicit and never become complete by row count alone", () => {
  const rows = [
    ...Array.from({ length: 11 }, (_, index) => ({
      date: "2026-08-07",
      venue: "三国",
      raceNo: index + 1,
    })),
    { date: "2026-08-07", venue: "鳴門", raceNo: 12 },
  ];
  const summary = summarizeOfficialProgramDayInventory("2026-08-07", rows);
  assert.equal(summary.totalRows, 12);
  assert.equal(summary.venueCount, 2);
  assert.equal(summary.completeVenueCount, 0);
  assert.equal(summary.structurallyComplete, false);
  assert.deepEqual(summary.incompleteVenues, [
    { venue: "三国", raceNos: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], missingRaceNos: [12] },
    { venue: "鳴門", raceNos: [12], missingRaceNos: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  ]);
});
