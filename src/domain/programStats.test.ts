import assert from "node:assert/strict";
import test from "node:test";
import { summarizeProgramStats } from "./programStats";
import type { DecisionHistoryRow } from "./backtest";

function row(id: number): DecisionHistoryRow {
  return {
    id,
    raceId: "r1",
    date: "2026-05-20",
    venue: "蒲郡",
    raceNo: 1,
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
    result: "1-2-3",
    payoutYen: 1600,
    popularity: null,
    returned: false,
    source: "test",
    fetchedAt: "now",
    createdAt: "now",
  };
}

test("番組表raw_jsonの艇情報から選手/モーター/級別ROIを集計する", () => {
  const summary = summarizeProgramStats([row(1)], new Map([["r1", { boats: [{ course: 1, registrationNo: "4772", racerName: "石丸海渡", className: "A1", motorNo: "17" }] }]]));
  assert.equal(summary.racersBest[0].label, "4772 石丸海渡");
  assert.equal(summary.motorsBest[0].label, "M17");
  assert.equal(summary.classes[0].label, "A1");
});
