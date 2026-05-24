import assert from "node:assert/strict";
import test from "node:test";
import { calculateSavings, countConsecutiveNoBuyDays } from "./savings";
import type { DecisionHistoryRow } from "./backtest";

function row(input: Partial<DecisionHistoryRow> & { id: number; date: string; decision: "BUY" | "WATCH" | "SKIP" }): DecisionHistoryRow {
  return {
    raceId: "r" + input.id,
    venue: "蒲郡",
    raceNo: input.id,
    selection: "1-2-3",
    estimatedHitRate: 0.1,
    requiredOdds: 12.5,
    currentOdds: 10,
    ev: 1,
    actuallyBought: false,
    stakeYen: 0,
    recommendedStakeYen: input.decision === "BUY" ? 100 : 0,
    sampleSize: 100,
    result: null,
    payoutYen: null,
    popularity: null,
    returned: false,
    source: "test",
    fetchedAt: "now",
    createdAt: "now",
    ...input,
  };
}

test("全BUYを買っていたら負けた金額を節約額にする", () => {
  const summary = calculateSavings([
    row({ id: 1, date: "2026-05-20", decision: "BUY", result: "2-1-3", payoutYen: 0 }),
    row({ id: 2, date: "2026-05-20", decision: "BUY", result: "3-1-2", payoutYen: 0 }),
    row({ id: 3, date: "2026-05-20", decision: "SKIP" }),
  ]);
  assert.equal(summary.simulatedStakeYen, 200);
  assert.equal(summary.simulatedPayoutYen, 0);
  assert.equal(summary.simulatedNetYen, -200);
  assert.equal(summary.savedLossYen, 200);
  assert.equal(summary.missedProfitYen, 0);
  assert.equal(summary.protectedStakeYen, 200);
});

test("全BUYを買っていたら勝っていた場合は取り逃し利益にする", () => {
  const summary = calculateSavings([
    row({ id: 1, date: "2026-05-20", decision: "BUY", result: "1-2-3", currentOdds: 16, payoutYen: 9999 }),
  ]);
  assert.equal(summary.savedLossYen, 0);
  assert.equal(summary.missedProfitYen, 1500);
});

test("実購入がある日で買わない連続日数を止める", () => {
  const rows = [
    row({ id: 1, date: "2026-05-22", decision: "SKIP" }),
    row({ id: 2, date: "2026-05-21", decision: "WATCH" }),
    row({ id: 3, date: "2026-05-20", decision: "BUY", actuallyBought: true, stakeYen: 100 }),
    row({ id: 4, date: "2026-05-19", decision: "SKIP" }),
  ];
  assert.equal(countConsecutiveNoBuyDays(rows, "2026-05-22"), 2);
});
