import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRollingDrift } from "./rollingDrift";
import type { DecisionHistoryRow } from "./backtest";

function row(id: number, result: string | null): DecisionHistoryRow {
  return {
    id,
    raceId: "r" + id,
    date: "2026-05-01",
    venue: "蒲郡",
    raceNo: id,
    selection: "1-2-3",
    estimatedHitRate: 0.2,
    requiredOdds: 6.25,
    currentOdds: 10,
    ev: 2,
    decision: "BUY",
    actuallyBought: false,
    stakeYen: 0,
    recommendedStakeYen: 100,
    sampleSize: 1000,
    result,
    payoutYen: result ? 1000 : null,
    popularity: null,
    returned: false,
    source: "test",
    fetchedAt: "2026-05-01T00:00:00+09:00",
    createdAt: "2026-05-01T00:00:00+09:00",
  };
}

test("月別の推定的中率ズレを検出する", () => {
  const summary = summarizeRollingDrift([1, 2, 3, 4, 5, 6].map((n) => row(n, null)));
  assert.equal(summary.latest?.alert, "drift");
});
