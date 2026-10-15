import assert from "node:assert/strict";
import test from "node:test";
import { summarizeBuyLedger } from "./accuracyScorecard";
import { formatBuyAlert, formatDailySummary, formatWeeklySummary } from "./lineMessages";

test("BUY の通知は 🔔 で始まり、オッズ・当たる確率・期待回収を平易に出す", () => {
  const { title, body } = formatBuyAlert({
    venue: "常滑", raceNo: 8, selection: "1-2-3", closeAt: "13:46", quoteOdds: 66.1,
    calibratedProbability: 0.011, v3Probability: 0.058, voteUrl: "https://example.invalid/vote",
  });
  assert.equal(title, "🔔 BUY 常滑8R 1-2-3（締切 13:46）");
  assert.match(body, /^オッズ 66\.1倍 → 当たれば 100円が 6,610円/);
  assert.match(body, /当たる確率: 約1\.1%（v3 の予想は 5\.8%）/);
  assert.match(body, /期待回収: 73%（続けると 100円あたり約73円が戻る計算）/);
  assert.doesNotMatch(body, /これまでの BUY/);
  assert.match(body, /※paper検証（実際の購入なし）$/);
  assert.doesNotMatch(`${title}\n${body}`, /🎯|EV|logloss/);
});

test("市場補正が計算できないときは v3 の予想だけを出す", () => {
  const { body } = formatBuyAlert({
    venue: "福岡", raceNo: 5, selection: "1-2-3", closeAt: null, quoteOdds: null,
    calibratedProbability: null, v3Probability: 0.06, voteUrl: "https://example.invalid/vote",
  });
  assert.match(body, /^当たる確率: v3 の予想で 6\.0%（市場補正は計算できず）/);
});

const ledger = (rows: Array<[string, boolean | null, number | null]>) => summarizeBuyLedger(rows.map(([date, hit, payoutYen]) => ({ date, hit, payoutYen })));

test("日次まとめは、今日の BUY の結果・昨日の結果・今月と通算を順に出す", () => {
  const { title, body } = formatDailySummary({
    date: "2026-10-14",
    todayBuys: [
      { venue: "常滑", raceNo: 8, selection: "1-2-3", notified: true, result: "hit", payoutYen: 4_270 },
      { venue: "津", raceNo: 4, selection: "1-2-3", notified: true, result: "pending", payoutYen: null },
    ],
    lastSettledDay: { date: "2026-10-13", ledger: ledger([["2026-10-13", false, null], ["2026-10-13", false, null]]) },
    month: ledger([["2026-10-13", false, null], ["2026-10-13", false, null]]),
    total: ledger([["2026-08-01", true, 4_270], ["2026-10-13", false, null]]),
    sinceFix: { from: "2026-10-10", ledger: ledger([["2026-10-13", false, null]]), notified: 1 },
    notifiedTotal: ledger([["2026-10-13", false, null], ["2026-10-13", false, null]]),
    alerts: ["ジョブ auto-odds が 3.0 時間動いていない"],
    counts: { buy: 2, watch: 5, skip: 115, oddsPresent: 122, total: 122 },
    coverage: { programs: 156, t5Races: 88 },
  });
  assert.equal(title, "📊 10/14 のまとめ: BUY 2件 → ✅1 ❌0｜通算 +4,070円");
  assert.match(body, /記録できたレース: 判定 122\/156・締切5分前のオッズ 88\/156（足りない分は PC のスリープや取得の失敗で記録なし）/);
  assert.match(body, /・常滑8R 1-2-3（🔔 通知済み）→ ✅ 的中 4,270円/);
  assert.match(body, /・津4R 1-2-3（🔔 通知済み）→ ⏳ 結果待ち/);
  assert.match(body, /10\/13 の結果: 0勝 2敗（-200円）/);
  assert.match(body, /💰 収支（100円ずつ買った場合・公式の払戻）\n今月: 0勝 2敗・収支 -200円（払戻 0円 \/ 買った額 200円・回収率 0%）\n通算: 1勝 1敗・収支 \+4,070円（払戻 4,270円 \/ 買った額 200円・回収率 2135%）/);
  assert.match(body, /うち締切前に通知できた分（実際に買えた分）: 0勝 2敗・収支 -200円（払戻 0円 \/ 買った額 200円・回収率 0%）/);
  assert.doesNotMatch(body, /以降（締切前に判定を固定した記録）/);
  assert.match(body, /⚠️ 注意 1 件: ジョブ auto-odds が 3\.0 時間動いていない/);
  assert.doesNotMatch(`${title}\n${body}`, /🎯|model=|EV/);
});

test("BUY が無い日は見送りの件数だけを出す", () => {
  const { title, body } = formatDailySummary({
    date: "2026-10-14", todayBuys: [], lastSettledDay: null,
    month: ledger([]), total: ledger([]), alerts: [],
    counts: { buy: 0, watch: 3, skip: 150, oddsPresent: 100, total: 156 },
  });
  assert.equal(title, "📊 10/14 のまとめ: BUY 0件｜通算 +0円");
  assert.match(body, /^今日の BUY: なし（見送り 150 レース）/);
});

test("週次まとめは、先週と比べた良し悪しを各行に付ける", () => {
  const week = (rows: Array<[string, boolean | null, number | null]>, notified: number, t5: number | null, gap: number | null) => ({
    from: "2026-10-07", to: "2026-10-13", buys: ledger(rows), notified, decisionCoverage: 0.8, t5Coverage: t5, logLossGap: gap,
  });
  const { title, body } = formatWeeklySummary({
    thisWeek: week([["2026-10-08", false, null], ["2026-10-09", false, null]], 2, 0.72, 0.0146),
    lastWeek: { ...week([["2026-10-01", false, null], ["2026-10-02", false, null]], 0, 0.6, 0.0121), from: "2026-09-30", to: "2026-10-06" },
    knowledgeAdded: 4,
    alerts: [],
    total: ledger([["2026-08-01", true, 4_270], ["2026-10-13", false, null]]),
  });
  assert.equal(title, "📈 週次まとめ（10/7〜10/13）");
  assert.match(body, /通算: 1勝 1敗・収支 \+4,070円（払戻 4,270円 \/ 買った額 200円・回収率 2135%）/);
  assert.match(body, /^成績: BUY 2件 → 0勝 2敗（-200円）\n　先週: BUY 2件 → 0勝 2敗（-200円）/);
  assert.match(body, /締切前に通知できた BUY: 2\/2（先週 0\/2） ↑/);
  assert.match(body, /オッズの収集（締切5分前の全120通り）: 72%（先週 60%） ↑/);
  assert.match(body, /確率の精度: v3 は市場補正より 0\.015 不正確（先週 0\.012、小さいほど良い） ↓/);
  assert.match(body, /知識: 今週 \+4 件/);
});

test("BUY の通知に、これまでの BUY の通算成績（勝敗・収支・回収率）を出す", () => {
  const { body } = formatBuyAlert({
    venue: "常滑", raceNo: 8, selection: "1-2-3", closeAt: "13:46", quoteOdds: 66.1,
    calibratedProbability: 0.011, v3Probability: 0.058, voteUrl: "https://example.invalid/vote",
    total: ledger([["2026-08-01", true, 4_270], ["2026-10-13", false, null], ["2026-10-14", null, null]]),
  });
  assert.match(body, /これまでの BUY: 1勝 1敗（\+4,070円）・回収率 2135%\n\n投票:/);
});
