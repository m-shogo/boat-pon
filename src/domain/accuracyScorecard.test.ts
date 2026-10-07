import assert from "node:assert/strict";
import test from "node:test";
import { binaryMetrics, calibratedMarketProbabilities, normalizedMarketProbabilities, summarizeBuyLedger } from "./accuracyScorecard";

test("binaryMetrics は期待的中数・Brier・logloss を出す", () => {
  const result = binaryMetrics([{ p: 0.5, hit: 1 }, { p: 0.5, hit: 0 }]);
  assert.equal(result.n, 2);
  assert.equal(result.hits, 1);
  assert.equal(result.expectedHits, 1);
  assert.equal(result.actualToPredicted, 1);
  assert.equal(result.brier, 0.25);
  assert.ok(Math.abs((result.logLoss ?? 0) - Math.log(2)) < 1e-12);
});

test("binaryMetrics は空入力で null を返す", () => {
  const result = binaryMetrics([]);
  assert.equal(result.n, 0);
  assert.equal(result.brier, null);
  assert.equal(result.actualToPredicted, null);
});

test("市場確率は控除分を除いて合計1になる", () => {
  const p = normalizedMarketProbabilities(new Map([["1-2-3", 2], ["2-1-3", 4]]))!;
  assert.ok(Math.abs([...p.values()].reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(Math.abs(p.get("1-2-3")! - 2 / 3) < 1e-12);
});

test("1倍以下や非数のオッズがあれば市場確率は null", () => {
  assert.equal(normalizedMarketProbabilities(new Map([["1-2-3", 1], ["2-1-3", 4]])), null);
  assert.equal(normalizedMarketProbabilities(new Map([["1-2-3", Number.NaN]])), null);
});

test("temperature<1 は本命を、late money は直前に買われた買い目を引き上げる", () => {
  const t5 = new Map([["1-2-3", 2], ["2-1-3", 4]]);
  const base = normalizedMarketProbabilities(t5)!;
  const tempOnly = calibratedMarketProbabilities(t5, null, { temperature: 0.9, lateMoneyBeta: 0 })!;
  assert.ok(tempOnly.get("1-2-3")! > base.get("1-2-3")!);
  const earlier = new Map([["1-2-3", 2], ["2-1-3", 8]]);
  const withMomentum = calibratedMarketProbabilities(t5, earlier, { temperature: 1, lateMoneyBeta: 0.5 })!;
  assert.ok(withMomentum.get("2-1-3")! > base.get("2-1-3")!);
  assert.ok(Math.abs([...withMomentum.values()].reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test("BUY 台帳は未精算を ROI の分母に入れない", () => {
  const summary = summarizeBuyLedger([
    { date: "2026-09-01", hit: true, payoutYen: 4000 },
    { date: "2026-09-02", hit: false, payoutYen: null },
    { date: "2026-10-01", hit: null, payoutYen: null },
  ]);
  assert.equal(summary.buys, 3);
  assert.equal(summary.settled, 2);
  assert.equal(summary.hits, 1);
  assert.equal(summary.misses, 1);
  assert.equal(summary.officialRoi, 20);
  assert.deepEqual(summary.byMonth.map((m) => [m.month, m.settled, m.officialRoi]), [["2026-09", 2, 20], ["2026-10", 0, null]]);
});
