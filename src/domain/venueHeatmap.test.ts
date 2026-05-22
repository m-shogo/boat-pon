import assert from "node:assert/strict";
import test from "node:test";
import { summarizeVenueHeatmap } from "./venueHeatmap";
import type { DecisionHistoryRow } from "./backtest";

function row(id: number, venue: string, date: string, hit: boolean): DecisionHistoryRow {
  return {
    id,
    raceId: "r" + id,
    date,
    venue,
    raceNo: id,
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

test("会場別月別ROIセルと得意苦手Top3を返す", () => {
  const summary = summarizeVenueHeatmap([
    row(1, "蒲郡", "2026-05-20", true),
    row(2, "蒲郡", "2026-06-20", false),
    row(3, "丸亀", "2026-05-20", false),
  ]);
  assert.deepEqual(summary.months, ["2026-05", "2026-06"]);
  const cell = summary.cells.find((row) => row.venue === "蒲郡" && row.ym === "2026-05");
  assert.equal(cell?.modelRoi, 16);
  assert.equal(summary.best[0].venue, "蒲郡");
  assert.equal(summary.worst[0].venue, "丸亀");
});
