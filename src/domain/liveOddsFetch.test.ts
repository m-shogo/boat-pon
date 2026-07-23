import assert from "node:assert/strict";
import test from "node:test";
import { alignRaceRowsToPrograms, isCompleteTrifectaCheckpoint, isScheduledCollectionHour, prioritizeRaceRows, runWithConcurrency, uniqueRaceRows } from "./liveOddsFetch";

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

test("scheduled収集はJST 8:00〜21:05だけ動く", () => {
  assert.equal(isScheduledCollectionHour(new Date("2026-07-18T08:00:00+09:00")), true);
  assert.equal(isScheduledCollectionHour(new Date("2026-07-18T21:05:00+09:00")), true);
  assert.equal(isScheduledCollectionHour(new Date("2026-07-18T07:59:00+09:00")), false);
  assert.equal(isScheduledCollectionHour(new Date("2026-07-18T21:06:00+09:00")), false);
});

test("締切が近いレースを先にし、同一raceIdは1件にする", () => {
  const rows = [
    { candidate: { raceId: "late" }, minutes: 20 },
    { candidate: { raceId: "near" }, minutes: 6 },
    { candidate: { raceId: "near" }, minutes: 7 },
  ];
  assert.deepEqual(prioritizeRaceRows(rows, (row) => row.minutes).map((row) => row.candidate.raceId), ["near", "late"]);
});

test("3連単checkpointは120通り以上で完全", () => {
  assert.equal(isCompleteTrifectaCheckpoint(119), false);
  assert.equal(isCompleteTrifectaCheckpoint(120), true);
});

test("モデル候補が無い公式番組も収集対象から落とさない", () => {
  const programs = [{ raceId: "race-1" }, { raceId: "race-2" }];
  const rows = [{ candidate: { raceId: "race-1" }, source: "model" }];
  const aligned = alignRaceRowsToPrograms(programs, rows, (program) => ({ candidate: program, source: "program-fallback" }));
  assert.deepEqual(aligned.map((row) => [row.candidate.raceId, row.source]), [["race-1", "model"], ["race-2", "program-fallback"]]);
});

test("入力順に払い出しながら同時実行数を制限する", async () => {
  const started: number[] = [];
  let active = 0;
  let maxActive = 0;
  const releases: Array<() => void> = [];
  const running = runWithConcurrency([1, 2, 3, 4], 2, async (item) => {
    started.push(item);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2]);
  releases.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2, 3]);
  releases.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  releases.shift()?.();
  releases.shift()?.();
  await running;
  assert.equal(maxActive, 2);
});

test("不正な同時実行数を拒否する", async () => {
  await assert.rejects(runWithConcurrency([1], 0, async () => {}), /positive integer/);
});
