import assert from "node:assert/strict";
import test from "node:test";
import { summarizeShadowTop1, type ShadowTop1Row } from "./shadowTop1";

function row(input: Partial<ShadowTop1Row> = {}): ShadowTop1Row {
  return {
    raceId: "r1", date: "2025-01-01", selection: "1-2-3", decision: "BUY",
    currentOdds: 10, result: "9-9-9", payoutYen: 1000, ...input,
  };
}

test("shadow top1は公式払戻を主ROI、取得オッズを補助ROIにする", () => {
  const summary = summarizeShadowTop1([
    row({ result: "1-2-3", payoutYen: 800, currentOdds: 10 }),
    row({ raceId: "r2" }),
  ]);
  assert.equal(summary.overall.payoutRoi, 4);
  assert.equal(summary.overall.currentOddsRoi, 5);
  assert.equal(summary.overall.hits, 1);
});

test("最大高配当除外ROIとドローダウンを分離して返す", () => {
  const summary = summarizeShadowTop1([
    row({ result: "1-2-3", payoutYen: 1000 }), row({ raceId: "r2" }), row({ raceId: "r3" }),
  ]);
  assert.equal(summary.overall.payoutRoiExTop1, 0);
  assert.equal(summary.overall.maxDrawdownYen, 200);
  assert.equal(summary.overall.maxLossStreak, 2);
});

test("BUY以外と未確定BUYをROI母集団へ混ぜない", () => {
  const summary = summarizeShadowTop1([
    row({ decision: "WATCH" }), row({ raceId: "r2", result: null, payoutYen: null }),
  ]);
  assert.equal(summary.buy, 1);
  assert.equal(summary.watch, 1);
  assert.equal(summary.unsettledBuy, 1);
  assert.equal(summary.overall.n, 0);
  assert.equal(summary.overall.payoutRoi, null);
});
