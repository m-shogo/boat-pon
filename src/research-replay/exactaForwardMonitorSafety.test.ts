import assert from "node:assert/strict";
import test from "node:test";

import {
  requireExactaForwardMonitorRaceIdentities,
  requireExactaForwardMonitorRaceIdentity,
} from "./exactaForwardMonitorSafety";

const valid = () => ({
  raceId: "20260823-宮島-06",
  date: "2026-08-23",
  venue: "宮島",
  raceNo: 6,
});

test("exacta forward monitor accepts canonical race lineage", () => {
  assert.doesNotThrow(() => requireExactaForwardMonitorRaceIdentity(valid()));
  assert.doesNotThrow(() => requireExactaForwardMonitorRaceIdentity({
    raceId: "20280229-大村-12",
    date: "2028-02-29",
    venue: "大村",
    raceNo: 12,
  }));
});

test("exacta forward monitor rejects invalid or mismatched race lineage", () => {
  const invalid = [
    { ...valid(), raceId: "20260230-宮島-06", date: "2026-02-30" },
    { ...valid(), raceId: "20260823-unknown-06", venue: "unknown" },
    { ...valid(), raceId: "20260823-17-06", venue: "17" },
    { ...valid(), raceId: "20260823-宮島-13", raceNo: 13 },
    { ...valid(), raceId: "20260824-宮島-06" },
  ];
  for (const race of invalid) {
    assert.throws(
      () => requireExactaForwardMonitorRaceIdentity(race),
      /EXACTA_FORWARD_MONITOR_(RACE_IDENTITY|VENUE)_INVALID/u,
    );
  }
});

test("exacta forward monitor fails closed on any invalid cohort race", () => {
  assert.throws(
    () => requireExactaForwardMonitorRaceIdentities([
      valid(),
      { ...valid(), raceId: "20260824-宮島-06" },
      { ...valid(), raceId: "20260825-宮島-06", date: "2026-08-25" },
    ]),
    /EXACTA_FORWARD_MONITOR_RACE_IDENTITY_INVALID/u,
  );
});
