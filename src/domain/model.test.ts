import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidatesFromModel, buildVenueModel } from "./model";
import type { RaceResult } from "./types";

function result(id: number, venue: string, trifecta: string): RaceResult {
  return {
    raceId: `r${id}`,
    date: "2026-05-20",
    venue,
    raceNo: id,
    trifecta,
    payoutYen: 1000,
    popularity: 1,
    returned: false,
    source: "test",
    fetchedAt: "2026-05-20T00:00:00+09:00",
  };
}

test("会場ごとにコース別1着/2着/3着率を集計する", () => {
  const model = buildVenueModel([
    result(1, "蒲郡", "1-2-3"),
    result(2, "蒲郡", "1-3-2"),
    result(3, "蒲郡", "2-1-3"),
  ], 1, 0);

  const gamagori = model.find((row) => row.venue === "蒲郡" && row.selection === "1-2-3");
  assert.ok(gamagori);
  const course1 = gamagori.courseRates.find((row) => row.course === 1);
  assert.equal(course1?.first, 2 / 3);
  assert.equal(course1?.second, 1 / 3);
  assert.equal(course1?.third, 0);
});

test("1着艇番ごとの2着-3着分布を作る", () => {
  const model = buildVenueModel([
    result(1, "蒲郡", "1-2-3"),
    result(2, "蒲郡", "1-2-3"),
    result(3, "蒲郡", "1-3-2"),
  ], 1, 0);
  const row = model.find((m) => m.venue === "蒲郡")!;
  const dist = row.secondThirdDistribution.find((d) => d.firstCourse === 1 && d.secondCourse === 2 && d.thirdCourse === 3);
  assert.equal(dist?.count, 2);
  assert.equal(dist?.probability, 2 / 3);
});

test("estimatedHitRateはLaplaceスムージングした観測頻度を使う", () => {
  const model = buildVenueModel([
    result(1, "蒲郡", "1-2-3"),
    result(2, "蒲郡", "1-2-3"),
    result(3, "蒲郡", "2-1-3"),
  ], 1, 1);
  const row = model.find((m) => m.venue === "蒲郡" && m.selection === "1-2-3");
  assert.equal(row?.hitCount, 2);
  assert.equal(row?.estimatedHitRate, 3 / 123);
});

test("モデル候補に手動オッズを反映する", () => {
  const model = buildVenueModel([result(1, "蒲郡", "1-2-3")], 1, 0);
  const candidates = buildCandidatesFromModel(
    [{ date: "2026-05-20", venue: "蒲郡", raceNo: 8, closeAt: "18:42" }],
    model,
    1.25,
    "now",
    new Map([["20260520-蒲郡-08", 15.7]]),
  );
  assert.equal(candidates[0].selection.join("-"), "1-2-3");
  assert.equal(candidates[0].currentOdds, 15.7);
});
