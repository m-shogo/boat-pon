import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULE, judgeCandidate, requiredOdds } from "./decision";
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
