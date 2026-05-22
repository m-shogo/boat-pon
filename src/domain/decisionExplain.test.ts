import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULE, judgeCandidate } from "./decision";
import { explainDecision, summarizeSkipReasons } from "./decisionExplain";
import type { DecisionHistoryRow } from "./backtest";
import type { BetCandidate } from "./types";

const candidate: BetCandidate = {
  raceId: "20260521-蒲郡-08",
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
  source: "test",
  fetchedAt: "2026-05-21T18:00:00+09:00",
};

test("BUY判定の人間向け説明とチェックリストを作る", () => {
  const decision = judgeCandidate(candidate, DEFAULT_RULE, { now: new Date("2026-05-21T18:00:00+09:00") });
  const explanation = explainDecision(candidate, decision, DEFAULT_RULE);
  assert.equal(explanation.tone, "buy");
  assert.match(explanation.headline, /公式/);
  assert.ok(explanation.checklist.some((item) => item.label === "EV" && item.ok));
});

test("履歴からSKIP理由の偏りを推定する", () => {
  const base = {
    id: 1,
    raceId: "r1",
    date: "2026-05-21",
    venue: "蒲郡",
    raceNo: 1,
    selection: "1-2-3",
    estimatedHitRate: 0.01,
    requiredOdds: 125,
    currentOdds: null,
    ev: null,
    decision: "SKIP",
    actuallyBought: false,
    stakeYen: 0,
    recommendedStakeYen: 0,
    sampleSize: 10,
    result: null,
    payoutYen: null,
    popularity: null,
    returned: false,
    source: "test",
    fetchedAt: "2026-05-21T12:00:00+09:00",
    createdAt: "2026-05-21T12:00:00+09:00",
  } satisfies DecisionHistoryRow;
  const summary = summarizeSkipReasons([base], DEFAULT_RULE);
  assert.deepEqual(summary.map((row) => row.reason), ["オッズ未取得", "サンプル不足"]);
});
