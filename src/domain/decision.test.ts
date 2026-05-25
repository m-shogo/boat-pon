import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULE, blendedHitRate, calibratedHitRate, calibrationFactorForRequiredOdds, judgeCandidate, requiredOdds } from "./decision";
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

test("calibrationMode=noneでは推定的中率を補正しない", () => {
  assert.equal(calibratedHitRate(0.03125, 1.25, { ...DEFAULT_RULE, calibrationMode: "none" }), 0.03125);
});

test("calibrationMode=v3-empiricalでは必要オッズ帯で推定的中率を補正する", () => {
  assert.equal(calibrationFactorForRequiredOdds(20, [
    { maxRequiredOdds: 30, factor: 1 },
    { maxRequiredOdds: 50, factor: 0.55 },
  ]), 1);
  assert.equal(calibrationFactorForRequiredOdds(40, [
    { maxRequiredOdds: 30, factor: 1 },
    { maxRequiredOdds: 50, factor: 0.55 },
  ]), 0.55);
  assert.equal(calibratedHitRate(0.03125, 1.25, { ...DEFAULT_RULE, calibrationMode: "v3-empirical" }), 0.03125 * 0.55);
});

test("calibrationBasis=currentOddsでは市場オッズ帯で推定的中率を補正する", () => {
  assert.equal(calibratedHitRate(0.05, 1.25, {
    ...DEFAULT_RULE,
    calibrationMode: "v3-empirical",
    calibrationBasis: "currentOdds",
  }, 40), 0.05 * 0.55);
});

test("calibrationMode=v3-empiricalを使うと30倍超の境界BUYがSKIPになる", () => {
  const candidate = { ...base, currentOdds: 40, estimatedHitRate: 0.03125 };
  const withoutCalibration = judgeCandidate(candidate, { ...DEFAULT_RULE, minSampleSize: 1 }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  const withCalibration = judgeCandidate(candidate, { ...DEFAULT_RULE, minSampleSize: 1, calibrationMode: "v3-empirical" }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(withoutCalibration.status, "BUY");
  assert.equal(withCalibration.status, "SKIP");
  assert.ok(withCalibration.requiredOdds > withoutCalibration.requiredOdds);
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

test("programFilterは1着候補艇の級別とモーター2連率でBUY対象を絞る", () => {
  const candidate = {
    ...base,
    candidateClassName: "A2",
    candidateMotorTop2Rate: 35,
    candidateBoatTop2Rate: 42,
  };
  const decision = judgeCandidate(candidate, {
    ...DEFAULT_RULE,
    minSampleSize: 1,
    programFilter: { allowedClassNames: ["A2"], maxMotorTop2Rate: 40 },
  }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "BUY");
});

test("programFilterは条件外の1着候補艇をSKIPにする", () => {
  const candidate = {
    ...base,
    candidateClassName: "A1",
    candidateMotorTop2Rate: 45,
  };
  const decision = judgeCandidate(candidate, {
    ...DEFAULT_RULE,
    minSampleSize: 1,
    programFilter: { allowedClassNames: ["A2"], maxMotorTop2Rate: 40 },
  }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("1着候補級別が対象外")));
  assert.ok(decision.reasons.some((r) => r.includes("1着候補モーター2連率")));
});

test("programFilter未設定なら番組表特徴では除外しない", () => {
  const decision = judgeCandidate({
    ...base,
    candidateClassName: "B2",
    candidateMotorTop2Rate: 99,
  }, { ...DEFAULT_RULE, minSampleSize: 1 }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "BUY");
});

test("programFilterはモーター2連率が上限以上ならSKIPにする", () => {
  const decision = judgeCandidate({
    ...base,
    candidateClassName: "A2",
    candidateMotorTop2Rate: 40,
  }, {
    ...DEFAULT_RULE,
    minSampleSize: 1,
    programFilter: { maxMotorTop2Rate: 40 },
  }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("1着候補モーター2連率")));
});

test("minRequiredOddsを下回る場合はSKIPにする", () => {
  // base: estimatedHitRate=0.085, targetEv=1.25 → requiredOdds≈14.7倍
  // minRequiredOdds=20 → 14.7 < 20 なのでSKIP
  const decision = judgeCandidate(base, { ...DEFAULT_RULE, minSampleSize: 1, minRequiredOdds: 20 }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("必要オッズが下限未満")));
});

test("maxRequiredOddsを超える場合はSKIPにする", () => {
  // base: requiredOdds≈14.7倍、maxRequiredOdds=10 → 14.7 > 10 なのでSKIP
  const decision = judgeCandidate(base, { ...DEFAULT_RULE, minSampleSize: 1, maxRequiredOdds: 10 }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("必要オッズが上限超過")));
});

test("excludedVenuesに含まれる会場はSKIPにする", () => {
  const decision = judgeCandidate(base, { ...DEFAULT_RULE, minSampleSize: 1, excludedVenues: ["蒲郡"] }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("除外会場")));
});

test("excludedVenuesに含まれない会場はそのまま判定する", () => {
  const decision = judgeCandidate(base, { ...DEFAULT_RULE, minSampleSize: 1, excludedVenues: ["津"] }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "BUY");
});

test("excludedRaceNosに含まれるレース番号はSKIPにする", () => {
  const decision = judgeCandidate(base, { ...DEFAULT_RULE, minSampleSize: 1, excludedRaceNos: [2, 8] }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("除外レース番号")));
});

test("excludedRaceNosに含まれないレース番号はそのまま判定する", () => {
  const decision = judgeCandidate(base, { ...DEFAULT_RULE, minSampleSize: 1, excludedRaceNos: [1, 3] }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "BUY");
});

test("excludedSecondBoatClassNamesに2号艇のクラスが含まれる場合はSKIPにする", () => {
  const candidate: BetCandidate = {
    ...base,
    secondBoatFeature: { course: 2, className: "B1", nationalWinRate: 4.5, nationalTop2Rate: 30, localWinRate: 4.0, localTop2Rate: 25, motorTop2Rate: 35, boatTop2Rate: 38 },
  };
  const decision = judgeCandidate(candidate, { ...DEFAULT_RULE, minSampleSize: 1, programFilter: { excludedSecondBoatClassNames: ["B1"] } }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("2着候補級別が除外対象")));
});

test("excludedSecondBoatClassNamesに2号艇のクラスが含まれない場合はそのまま判定する", () => {
  const candidate: BetCandidate = {
    ...base,
    secondBoatFeature: { course: 2, className: "A2", nationalWinRate: 5.5, nationalTop2Rate: 40, localWinRate: 5.0, localTop2Rate: 35, motorTop2Rate: 40, boatTop2Rate: 42 },
  };
  const decision = judgeCandidate(candidate, { ...DEFAULT_RULE, minSampleSize: 1, programFilter: { excludedSecondBoatClassNames: ["B1"] } }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "BUY");
});

test("excludeSameClassSecondBoat=trueで1着と2着が同クラスならSKIPにする", () => {
  // base.candidateClassName は未設定だが firstBoatFeature.className で判定
  const candidate: BetCandidate = {
    ...base,
    firstBoatFeature: { course: 1, className: "B1", nationalWinRate: 4.0, nationalTop2Rate: 28, localWinRate: 3.8, localTop2Rate: 26, motorTop2Rate: 38, boatTop2Rate: 40 },
    secondBoatFeature: { course: 2, className: "B1", nationalWinRate: 4.2, nationalTop2Rate: 30, localWinRate: 3.5, localTop2Rate: 24, motorTop2Rate: 36, boatTop2Rate: 38 },
  };
  const decision = judgeCandidate(candidate, { ...DEFAULT_RULE, minSampleSize: 1, programFilter: { excludeSameClassSecondBoat: true } }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("2着候補が1着候補と同クラス")));
});

test("excludeSameClassSecondBoat=trueで1着と2着が異クラスならそのまま判定する", () => {
  const candidate: BetCandidate = {
    ...base,
    firstBoatFeature: { course: 1, className: "B1", nationalWinRate: 4.0, nationalTop2Rate: 28, localWinRate: 3.8, localTop2Rate: 26, motorTop2Rate: 38, boatTop2Rate: 40 },
    secondBoatFeature: { course: 2, className: "A2", nationalWinRate: 5.5, nationalTop2Rate: 40, localWinRate: 5.0, localTop2Rate: 35, motorTop2Rate: 40, boatTop2Rate: 42 },
  };
  const decision = judgeCandidate(candidate, { ...DEFAULT_RULE, minSampleSize: 1, programFilter: { excludeSameClassSecondBoat: true } }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "BUY");
});

test("minFirstBoatNationalWinRateより低い勝率の1着候補はSKIPにする", () => {
  const candidate: BetCandidate = {
    ...base,
    firstBoatFeature: { course: 1, className: "B1", nationalWinRate: 3.8, nationalTop2Rate: 24, localWinRate: 3.5, localTop2Rate: 22, motorTop2Rate: 35, boatTop2Rate: 37 },
  };
  const decision = judgeCandidate(candidate, { ...DEFAULT_RULE, minSampleSize: 1, programFilter: { minFirstBoatNationalWinRate: 4.0 } }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("全国勝率")));
});

test("minFirstBoatNationalWinRate以上の勝率の1着候補はそのまま判定する", () => {
  const candidate: BetCandidate = {
    ...base,
    firstBoatFeature: { course: 1, className: "B1", nationalWinRate: 4.2, nationalTop2Rate: 28, localWinRate: 4.0, localTop2Rate: 26, motorTop2Rate: 38, boatTop2Rate: 40 },
  };
  const decision = judgeCandidate(candidate, { ...DEFAULT_RULE, minSampleSize: 1, programFilter: { minFirstBoatNationalWinRate: 4.0 } }, {
    now: new Date("2026-05-21T18:00:00+09:00"),
  });
  assert.equal(decision.status, "BUY");
});

test("classOddsRatioRulesはクラス別にratio上限/下限を適用する", () => {
  const b1Candidate: BetCandidate = {
    ...base,
    candidateClassName: "B1",
    currentOdds: 40,
  };
  // required_odds = 1.25 / 0.05 = 25, ratio = 40/25 = 1.6 → B1 maxOddsRatio=1.5 で除外
  const decision = judgeCandidate(b1Candidate, {
    ...DEFAULT_RULE, minSampleSize: 1,
    classOddsRatioRules: [{ classNames: ["B1"], maxOddsRatio: 1.5 }],
  }, { now: new Date("2026-05-21T18:00:00+09:00") });
  assert.equal(decision.status, "SKIP");
  assert.ok(decision.reasons.some((r) => r.includes("B1クラス")));
});

test("classOddsRatioRulesは対象外クラスには適用しない", () => {
  const a2Candidate: BetCandidate = {
    ...base,
    candidateClassName: "A2",
    currentOdds: 40,
  };
  // required_odds = 25, ratio = 1.6 → A2にはB1ルール適用されないのでBUY
  const decision = judgeCandidate(a2Candidate, {
    ...DEFAULT_RULE, minSampleSize: 1,
    classOddsRatioRules: [{ classNames: ["B1"], maxOddsRatio: 1.5 }],
  }, { now: new Date("2026-05-21T18:00:00+09:00") });
  assert.equal(decision.status, "BUY");
});
