import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarketResidual, selectBlendedMarketCandidate } from "./marketResidual";

const rows = normalizeMarketResidual([
  { selection: "1-2-3", odds: 2, modelProbability: 0.2 },
  { selection: "1-3-2", odds: 4, modelProbability: 0.8 },
]);

test("市場確率とモデル確率をそれぞれ合計1へ正規化する", () => {
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.marketProbability, 0) - 1) < 1e-12);
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.normalizedModelProbability, 0) - 1) < 1e-12);
});

test("市場のみでは正規化overround由来のEVが全候補で一致する", () => {
  const selected = selectBlendedMarketCandidate(rows, 0);
  assert.equal(selected?.selection, "1-2-3");
  assert.ok(Math.abs((rows[0].marketProbability * rows[0].odds) - (rows[1].marketProbability * rows[1].odds)) < 1e-12);
});

test("モデルのみでは正規化モデルEV最大を選ぶ", () => {
  assert.equal(selectBlendedMarketCandidate(rows, 1)?.selection, "1-3-2");
});
