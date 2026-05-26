import assert from "node:assert/strict";
import test from "node:test";
import { summarizeEvaluation, type V4EvaluationRow } from "./v4Evaluation";

function row(input: Partial<V4EvaluationRow> & { raceId: string; decision: V4EvaluationRow["decision"] }): V4EvaluationRow {
  return {
    raceId: input.raceId,
    date: input.date ?? "2025-01-01",
    venue: input.venue ?? "蒲郡",
    raceNo: input.raceNo ?? 1,
    selection: input.selection ?? "1-2-3",
    className: input.className ?? "B1",
    decision: input.decision,
    hit: input.hit ?? false,
    returned: input.returned ?? false,
    requiredOdds: input.requiredOdds ?? 25,
    currentOdds: input.currentOdds ?? 30,
    ev: input.ev ?? 1.5,
    rawEstimatedHitRate: input.rawEstimatedHitRate ?? 0.08,
    conservativeHitRate: input.conservativeHitRate ?? 0.05,
    estimatedHitRate: input.estimatedHitRate ?? 0.05,
  };
}

test("v4評価集計はcurrent_odds基準でROIと最大払戻除外ROIを出す", () => {
  const report = summarizeEvaluation([
    row({ raceId: "r1", decision: "BUY", hit: true, currentOdds: 30 }),
    row({ raceId: "r2", decision: "BUY", hit: false, currentOdds: 40 }),
    row({ raceId: "r3", decision: "WATCH", currentOdds: 50 }),
  ]);
  assert.equal(report.overall.buy, 2);
  assert.equal(report.overall.hits, 1);
  assert.equal(report.overall.roi, 15);
  assert.equal(report.overall.roiExMax, 0);
});

test("v4評価集計は保守化率と帯別を返す", () => {
  const report = summarizeEvaluation([
    row({ raceId: "r1", decision: "BUY", rawEstimatedHitRate: 0.1, conservativeHitRate: 0.05, requiredOdds: 25, currentOdds: 30 }),
  ]);
  assert.equal(report.overall.avgConservativeDiscount, 0.5);
  assert.equal(report.byRequiredOddsBand[0].key, "25-30");
  assert.equal(report.byOddsRatioBand[0].key, "1.2-1.5");
  assert.equal(report.byClassName[0].key, "B1");
});
