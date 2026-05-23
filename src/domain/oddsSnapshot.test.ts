import assert from "node:assert/strict";
import test from "node:test";
import { filterCandidateSnapshots, latestOddsByRaceId, type OddsSnapshot } from "./oddsSnapshot";

const rows: OddsSnapshot[] = [
  { raceId: "r1", selection: "1-2-3", odds: 10, popularity: null, source: "manual", capturedAt: "2026-05-01T10:00:00+09:00", isFinalLike: false },
  { raceId: "r1", selection: "1-2-3", odds: 12, popularity: null, source: "official", capturedAt: "2026-05-01T10:05:00+09:00", isFinalLike: true },
  { raceId: "r2", selection: "1-3-2", odds: 8, popularity: 3, source: "kyotei24", capturedAt: "2026-05-01T10:06:00+09:00", isFinalLike: true },
];

test("raceIdごとの最新オッズを返す", () => {
  assert.equal(latestOddsByRaceId(rows).get("r1"), 12);
});

test("候補レースだけに絞れる", () => {
  assert.deepEqual(filterCandidateSnapshots(rows, new Set(["r2"])).map((row) => row.raceId), ["r2"]);
});
