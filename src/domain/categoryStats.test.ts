import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCategoryStats } from "./categoryStats";
import type { DecisionHistoryRow } from "./backtest";

function row(category: string): DecisionHistoryRow {
  return {
    id: Math.random(),
    raceId: category,
    date: "2026-05-23",
    venue: "蒲郡",
    raceNo: 1,
    selection: "1-2-3",
    estimatedHitRate: 0.1,
    requiredOdds: 12.5,
    currentOdds: 20,
    ev: 2,
    decision: "BUY",
    actuallyBought: false,
    stakeYen: 0,
    recommendedStakeYen: 100,
    sampleSize: 1000,
    result: "1-2-3",
    payoutYen: 1500,
    popularity: 1,
    returned: false,
    source: "test",
    fetchedAt: "2026-05-23T00:00:00+09:00",
    createdAt: "2026-05-23T00:00:00+09:00",
    modelVersion: "test",
    raceCategory: category,
  };
}

test("番組カテゴリ別BUY成績を集計する", () => {
  const summary = summarizeCategoryStats([row("一般"), row("一般"), row("女子")]);
  assert.equal(summary.rows[0].key, "一般");
  assert.equal(summary.rows[0].buy, 2);
});
