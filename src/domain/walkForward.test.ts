import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULE } from "./decision";
import { runWalkForwardBacktest, summarizeWalkForward } from "./walkForward";
import type { RaceResult } from "./types";

function result(id: number, date: string, trifecta: string): RaceResult {
  return {
    raceId: date.replaceAll("-", "") + "-蒲郡-" + String(id).padStart(2, "0"),
    date,
    venue: "蒲郡",
    raceNo: id,
    trifecta,
    payoutYen: trifecta === "1-2-3" ? 1600 : 0,
    popularity: 1,
    returned: false,
    source: "test",
    fetchedAt: date + "T20:00:00+09:00",
  };
}

test("ウォークフォワードは対象日より前の結果だけでモデルを作る", () => {
  const rows = runWalkForwardBacktest({
    results: [
      result(1, "2026-05-01", "1-2-3"),
      result(2, "2026-05-02", "1-2-3"),
      result(3, "2026-05-03", "4-5-6"),
      result(4, "2026-05-04", "4-5-6"),
    ],
    programs: [
      { date: "2026-05-03", venue: "蒲郡", raceNo: 3, closeAt: "18:00" },
      { date: "2026-05-05", venue: "蒲郡", raceNo: 5, closeAt: "18:00" },
    ],
    settings: { ...DEFAULT_RULE, minSampleSize: 1, minMinutesBeforeClose: 5 },
    oddsByRaceId: new Map([
      ["20260503-蒲郡-11", 80],
      ["20260505-蒲郡-05", 80],
    ]),
    minTrainRaceCount: 1,
    alpha: 0,
  });

  assert.equal(rows[0].trainResults, 2);
  assert.equal(rows[0].selection, "1-2-3");
  assert.equal(rows[1].trainResults, 4);
});

test("学習データ不足ならNO_MODELにする", () => {
  const rows = runWalkForwardBacktest({
    results: [result(1, "2026-05-01", "1-2-3")],
    programs: [{ date: "2026-05-01", venue: "蒲郡", raceNo: 1, closeAt: "18:00" }],
    settings: DEFAULT_RULE,
    minTrainRaceCount: 1,
  });
  assert.equal(rows[0].decision, "NO_MODEL");
  assert.equal(rows[0].trainResults, 0);
});

test("ウォークフォワード集計はBUYだけを検証投資にする", () => {
  const rows = runWalkForwardBacktest({
    results: [
      result(1, "2026-05-01", "1-2-3"),
      result(2, "2026-05-01", "1-2-3"),
      result(3, "2026-05-01", "1-2-3"),
      result(4, "2026-05-01", "1-2-3"),
      result(5, "2026-05-01", "1-2-3"),
      result(6, "2026-05-02", "1-2-3"),
      result(7, "2026-05-02", "1-2-3"),
      result(8, "2026-05-02", "1-2-3"),
      result(9, "2026-05-02", "1-2-3"),
      result(10, "2026-05-02", "1-2-3"),
      result(11, "2026-05-03", "1-2-3"),
    ],
    programs: [{ date: "2026-05-03", venue: "蒲郡", raceNo: 11, closeAt: "18:00" }],
    settings: { ...DEFAULT_RULE, minSampleSize: 1, minMinutesBeforeClose: 5 },
    oddsByRaceId: new Map([["20260503-蒲郡-11", 80]]),
    minTrainRaceCount: 1,
    alpha: 0,
  });
  const summary = summarizeWalkForward(rows, 100);
  assert.equal(summary.buy, 1);
  assert.equal(summary.hits, 1);
  assert.equal(summary.modelStakeYen, 100);
  assert.equal(summary.modelPayoutYen, 1600);
});
