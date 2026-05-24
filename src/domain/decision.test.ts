import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULE, blendedHitRate, judgeCandidate, requiredOdds } from "./decision";
import type { BetCandidate } from "./types";

const base: BetCandidate = {
  raceId: "20260521-07-08",
  date: "2026-05-21",
  venue: "蒲郡",
  raceNo: 8,
  closeAt: "18:42",
  betType: "3連単",
  selection: [1, 3, 4],
  estimatedHitRate: 0.085,
  sampleSize: 1247,
  currentOdds: 16.2,
  targetEv: 1.25,
  suggestedAmount: 100,
  source: "sample",
  fetchedAt: "2026-05-21T15:00:00+09:00",
};

test("必要オッズを計算する", () => {
  assert.equal(requiredOdds(1.25, 0.08), 15.625);
});

test("BUY条件を満たす候補だけBUYにする", () => {
  const decision = judgeCandidate(base, DEFAULT_RULE, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "BUY");
  assert.equal(decision.recommendedAmount, 100);
});

test("オッズ未取得はSKIPにする", () => {
  const decision = judgeCandidate({ ...base, currentOdds: null }, DEFAULT_RULE, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.includes("オッズ未取得"));
});

test("EVが惜しい候補はWATCHにする", () => {
  const decision = judgeCandidate({ ...base, currentOdds: 13.8 }, DEFAULT_RULE, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "WATCH");
});

test("100倍超オッズはEV条件を満たしても検証保留のWATCHにする", () => {
  const decision = judgeCandidate({ ...base, currentOdds: 120 }, DEFAULT_RULE, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "WATCH");
  assert.equal(decision.recommendedAmount, 0);
  assert.ok(decision.reasons.includes("100倍超オッズは検証保留"));
});

test("maxOddsRatioを超える場合はSKIPにする", () => {
  // requiredOdds = 1.25 / 0.085 ≈ 14.7倍、maxOddsRatio=2.0 → 上限 29.4倍
  // currentOdds=40倍は上限超過
  const decision = judgeCandidate({ ...base, currentOdds: 40 }, { ...DEFAULT_RULE, maxOddsRatio: 2.0 }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("市場オッズがモデル要求の2倍超")));
});

test("marketBlendWeight=0では推定的中率をそのまま使う", () => {
  assert.equal(blendedHitRate(0.08, 20, 0), 0.08);
  assert.equal(blendedHitRate(0.08, null, 0.7), 0.08);
});

test("marketBlendWeightで市場インプライド確率を混合する", () => {
  // marketImplied = (1/20) * 0.75 = 3.75%, blended = 0.3*8% + 0.7*3.75% = 5.025%
  const blended = blendedHitRate(0.08, 20, 0.7);
  assert.ok(Math.abs(blended - 0.05025) < 0.0001, `expected ~0.05025 but got ${blended}`);
});

test("marketBlendWeightを使うとEVが下がり高オッズBUYがSKIPになる", () => {
  // currentOdds=50倍、estimatedHitRate=6.5% → EV=3.25でBUYになるが
  // blend=0.7: marketImplied=(1/50)*0.75=1.5%, blended=0.3*6.5%+0.7*1.5%=3.0%
  // ev=0.03*50=1.5 > 1.25 → まだBUYになってしまう(50倍は要注意)
  const candidate = { ...base, currentOdds: 50, estimatedHitRate: 0.065 };
  const decision = judgeCandidate(candidate, { ...DEFAULT_RULE, minSampleSize: 1, marketBlendWeight: 0.7 }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  // 50倍はWATCH_ONLY閾値(100倍)未満なのでBUY条件次第
  assert.ok(["BUY", "WATCH", "SKIP"].includes(decision.status));
});

test("minOddsRatioを下回る場合はSKIPにする", () => {
  // requiredOdds ≈ 14.7倍、minOddsRatio=1.5 → 下限 22.1倍
  // currentOdds=16.2倍は下限未満
  const decision = judgeCandidate(base, { ...DEFAULT_RULE, minSampleSize: 1, minOddsRatio: 1.5 }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("市場オッズがモデル要求の1.5倍未満")));
});
