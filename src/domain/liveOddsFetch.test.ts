import assert from "node:assert/strict";
import test from "node:test";
import { isScheduledCollectionHour, uniqueRaceRows } from "./liveOddsFetch";

test("同一レースの候補120件を取得1件へ集約する", () => {
  const rows = Array.from({ length: 120 }, (_, index) => ({ candidate: { raceId: "race-1" }, index }));
  assert.deepEqual(uniqueRaceRows(rows), [rows[0]]);
});

test("レース順を保って異なるレースを残す", () => {
  const rows = [
    { candidate: { raceId: "race-1" }, value: 1 },
    { candidate: { raceId: "race-2" }, value: 2 },
    { candidate: { raceId: "race-1" }, value: 3 },
  ];
  assert.deepEqual(uniqueRaceRows(rows), rows.slice(0, 2));
});

test("scheduled収集はJST 9:00〜21:05だけ動く", () => {
  assert.equal(isScheduledCollectionHour(new Date("2026-07-18T09:00:00+09:00")), true);
  assert.equal(isScheduledCollectionHour(new Date("2026-07-18T21:05:00+09:00")), true);
  assert.equal(isScheduledCollectionHour(new Date("2026-07-18T08:59:00+09:00")), false);
  assert.equal(isScheduledCollectionHour(new Date("2026-07-18T21:06:00+09:00")), false);
});
