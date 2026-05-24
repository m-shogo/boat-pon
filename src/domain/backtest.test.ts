import assert from "node:assert/strict";
import test from "node:test";
import { splitTrainTestByDate, splitTrainTestByRatio, summarizeByMonth } from "./backtest";
import type { DecisionHistoryRow } from "./backtest";

function row(id: number, date: string, decision: "BUY" | "WATCH" | "SKIP", result: string | null, sampleSize = 100): DecisionHistoryRow {
  return {
    id,
    raceId: `r${id}`,
    date,
    venue: "蒲郡",
    raceNo: id,
    selection: "1-2-3",
    estimatedHitRate: 0.1,
    requiredOdds: 12.5,
    currentOdds: 13,
    ev: 1.3,
    decision,
    actuallyBought: false,
    stakeYen: 0,
    recommendedStakeYen: decision === "BUY" ? 100 : 0,
    sampleSize,
    result,
    payoutYen: result === "1-2-3" ? 1500 : 0,
    popularity: null,
    returned: false,
    source: "test",
    fetchedAt: "now",
    createdAt: "now",
  };
}

test("summarizeByMonthは月別ROI推移を返す", () => {
  const rows = [
    row(1, "2026-05-20", "BUY", "1-2-3"),
    row(2, "2026-05-21", "SKIP", null),
    row(3, "2026-06-01", "BUY", "2-1-3"),
  ];
  const summaries = summarizeByMonth(rows);
  assert.deepEqual(summaries.map((m) => m.ym), ["2026-05", "2026-06"]);
  assert.equal(summaries[0].modelStakeYen, 100);
  assert.equal(summaries[0].modelPayoutYen, 1300);
  assert.equal(summaries[0].noBuyDays, 1);
  assert.equal(summaries[1].modelRoi, 0);
});

test("summarizeByMonthは最小サンプル数で除外できる", () => {
  const summaries = summarizeByMonth([
    row(1, "2026-05-20", "BUY", "1-2-3", 10),
    row(2, "2026-05-21", "BUY", "1-2-3", 200),
  ], 100);
  assert.equal(summaries[0].decisions, 1);
  assert.equal(summaries[0].modelStakeYen, 100);
});

test("日付境界で学習期間とテスト期間を分割する", () => {
  const rows = [
    row(1, "2026-05-20", "BUY", null),
    row(2, "2026-05-21", "BUY", null),
    row(3, "2026-05-22", "BUY", null),
  ];
  const split = splitTrainTestByDate(rows, "2026-05-21");
  assert.deepEqual(split.train.map((r) => r.id), [1]);
  assert.deepEqual(split.test.map((r) => r.id), [2, 3]);
});

test("比率で学習期間とテスト期間を分割する", () => {
  const rows = [
    row(3, "2026-05-22", "BUY", null),
    row(1, "2026-05-20", "BUY", null),
    row(2, "2026-05-21", "BUY", null),
  ];
  const split = splitTrainTestByRatio(rows, 2 / 3);
  assert.deepEqual(split.train.map((r) => r.id), [1, 2]);
  assert.deepEqual(split.test.map((r) => r.id), [3]);
});
