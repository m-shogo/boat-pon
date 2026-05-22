import assert from "node:assert/strict";
import test from "node:test";
import { summarizeByRaceNo, summarizeByTimeBand } from "./segmentStats";
import type { DecisionHistoryRow } from "./backtest";

function row(id: number, raceNo: number, hit: boolean): DecisionHistoryRow {
  return {
    id,
    raceId: "r" + id,
    date: "2026-05-20",
    venue: "蒲郡",
    raceNo,
    selection: "1-2-3",
    estimatedHitRate: 0.1,
    requiredOdds: 12.5,
    currentOdds: 16,
    ev: 1.6,
    decision: "BUY",
    actuallyBought: false,
    stakeYen: 0,
    recommendedStakeYen: 100,
    sampleSize: 100,
    result: hit ? "1-2-3" : "2-1-3",
    payoutYen: hit ? 1600 : 0,
    popularity: null,
    returned: false,
    source: "test",
    fetchedAt: "now",
    createdAt: "now",
  };
}

test("レース番号別ROIを集計する", () => {
  const rows = summarizeByRaceNo([row(1, 1, true), row(2, 2, false)]);
  assert.equal(rows[0].modelRoi, 16);
  assert.equal(rows[1].modelRoi, 0);
});

test("時間帯別ROIを締切時刻から集計する", () => {
  const rows = summarizeByTimeBand([row(1, 1, true), row(2, 12, false)], new Map([["r1", "10:40"], ["r2", "19:50"]]));
  assert.equal(rows.find((r) => r.key === "morning")?.buy, 1);
  assert.equal(rows.find((r) => r.key === "night")?.buy, 1);
});
