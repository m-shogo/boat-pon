/**
 * LINE に送る文面（BUY の通知・日次まとめ）。1行目（見出し）だけで要点がわかるようにする。
 * 絵文字は種類ごとに固定する: BUY 🔔 / 的中 ✅ / はずれ ❌ / 返還 ↩️ / 結果待ち ⏳ / 日次まとめ 📊（🎯 は使わない）。
 * 専門用語（EV・logloss・モデル名）は LINE に出さず、スコアカードに寄せる。
 */
import type { BuyLedgerSummary } from "./accuracyScorecard";
import { formatNet, formatTally, formatTallyMoney } from "./buyResultNotification";

const PAPER_NOTE = "※paper検証（実際の購入なし）";
const yen = (value: number) => `${Math.round(value).toLocaleString("ja-JP")}円`;
const pct1 = (value: number) => `${(value * 100).toFixed(1)}%`;

export type BuyAlertInput = {
  venue: string;
  raceNo: number;
  selection: string;
  closeAt: string | null;
  quoteOdds: number | null;
  /** 市場補正の確率（いちばん正確な見積もり）。計算できなければ null。 */
  calibratedProbability: number | null;
  /** v3 の推定的中率（BUY 行では実態の数倍になりやすい）。 */
  v3Probability: number | null;
  voteUrl: string;
  /** これまでの BUY の通算成績（渡すと「これまでの BUY」の行を出す）。 */
  total?: BuyLedgerSummary;
};

export function formatBuyAlert(input: BuyAlertInput): { title: string; body: string } {
  const title = `🔔 BUY ${input.venue}${input.raceNo}R ${input.selection}${input.closeAt ? `（締切 ${input.closeAt}）` : ""}`;
  const lines: string[] = [];
  if (input.quoteOdds != null) lines.push(`オッズ ${input.quoteOdds.toFixed(1)}倍 → 当たれば 100円が ${yen(input.quoteOdds * 100)}`);
  if (input.calibratedProbability != null) {
    lines.push(`当たる確率: 約${pct1(input.calibratedProbability)}${input.v3Probability != null ? `（v3 の予想は ${pct1(input.v3Probability)}）` : ""}`);
    if (input.quoteOdds != null) {
      const back = Math.round(input.calibratedProbability * input.quoteOdds * 100);
      lines.push(`期待回収: ${back}%（続けると 100円あたり約${back}円が戻る計算）`);
    }
  } else if (input.v3Probability != null) {
    lines.push(`当たる確率: v3 の予想で ${pct1(input.v3Probability)}（市場補正は計算できず）`);
  }
  if (input.total && input.total.settled > 0) {
    lines.push(`これまでの BUY: ${formatTally(input.total)}・回収率 ${Math.round((input.total.officialRoi ?? 0) * 100)}%`);
  }
  lines.push("", `投票: ${input.voteUrl}`, PAPER_NOTE);
  return { title, body: lines.join("\n") };
}

export type DailyBuy = {
  venue: string;
  raceNo: number;
  selection: string;
  /** 締切前にリアルタイム通知できたか。 */
  notified: boolean;
  result: "hit" | "miss" | "returned" | "pending";
  payoutYen: number | null;
};

export type DailySummaryInput = {
  date: string;
  todayBuys: DailyBuy[];
  /** いちばん最近の「結果がそろった日」の成績（ふつうは昨日）。 */
  lastSettledDay: { date: string; ledger: BuyLedgerSummary } | null;
  month: BuyLedgerSummary;
  total: BuyLedgerSummary;
  /** 判定を締め切りで固定した後の記録（行動できた記録）。 */
  sinceFix?: { from: string; ledger: BuyLedgerSummary; notified: number };
  /** 通算のうち、締切前に通知できた BUY だけ（実際に行動できた分）。 */
  notifiedTotal?: BuyLedgerSummary;
  /** 本命予想（各レース1点）の成績。BUY と並べて比べる。 */
  favorite?: { lastSettledDay: { date: string; ledger: BuyLedgerSummary } | null; month: BuyLedgerSummary; total: BuyLedgerSummary; from: string };
  alerts: string[];
  counts: { buy: number; watch: number; skip: number; oddsPresent: number; total: number };
  /** その日の番組数と、締切5分前の全120通りのオッズを取れたレース数。欠けを番組数に対して見せる。 */
  coverage?: { programs: number; t5Races: number };
};

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

const resultMark = (buy: DailyBuy) => {
  if (buy.result === "hit") return `✅ 的中 ${buy.payoutYen == null ? "" : yen(buy.payoutYen)}`.trim();
  if (buy.result === "miss") return "❌ はずれ";
  if (buy.result === "returned") return "↩️ 返還";
  return "⏳ 結果待ち";
};

export function formatDailySummary(input: DailySummaryInput): { title: string; body: string } {
  const settledToday = input.todayBuys.filter((b) => b.result !== "pending");
  const hits = settledToday.filter((b) => b.result === "hit").length;
  const misses = settledToday.filter((b) => b.result === "miss").length;
  const titleResult = settledToday.length ? ` → ✅${hits} ❌${misses}` : "";
  const title = `📊 ${md(input.date)} のまとめ: BUY ${input.todayBuys.length}件${titleResult}｜通算 ${formatNet(input.total)}`;

  const lines: string[] = [];
  if (input.todayBuys.length === 0) {
    lines.push(`今日の BUY: なし（見送り ${input.counts.skip} レース）`);
  } else {
    lines.push("今日の BUY:");
    for (const buy of input.todayBuys) {
      lines.push(`・${buy.venue}${buy.raceNo}R ${buy.selection}（${buy.notified ? "🔔 通知済み" : "通知なし"}）→ ${resultMark(buy)}`);
    }
    if (input.todayBuys.some((b) => b.result === "pending")) lines.push("（結果待ちは、明日の夜の取り込みで確定）");
  }
  if (input.lastSettledDay && input.lastSettledDay.date !== input.date && input.lastSettledDay.ledger.settled > 0) {
    lines.push(`${md(input.lastSettledDay.date)} の結果: ${formatTally(input.lastSettledDay.ledger)}`);
  }
  lines.push(
    "",
    "💰 収支（100円ずつ買った場合・公式の払戻）",
    `今月: ${formatTallyMoney(input.month)}`,
    `通算: ${formatTallyMoney(input.total)}`,
  );
  if (input.notifiedTotal) {
    lines.push(`うち締切前に通知できた分（実際に買えた分）: ${formatTallyMoney(input.notifiedTotal)}`);
  }
  const fav = input.favorite;
  if (fav && fav.total.settled > 0) {
    lines.push("", "⭐ 本命予想（参考。各レースで締切前のオッズがいちばん当たりやすい1点を、後から集計。通知・購入の推奨ではない）");
    if (fav.lastSettledDay) lines.push(`${md(fav.lastSettledDay.date)}: ${formatTallyMoney(fav.lastSettledDay.ledger)}`);
    lines.push(`今月: ${formatTallyMoney(fav.month)}`, `${md(fav.from)} から: ${formatTallyMoney(fav.total)}`);
    if (input.total.settled > 0) {
      const pct = (l: BuyLedgerSummary) => `${Math.round((l.officialRoi ?? 0) * 100)}%`;
      const hitRate = (l: BuyLedgerSummary) => `${((l.hits / l.settled) * 100).toFixed(1)}%`;
      lines.push(`比べると（通算）: 的中率 BUY ${hitRate(input.total)} / 本命予想 ${hitRate(fav.total)}・回収率 BUY ${pct(input.total)} / 本命予想 ${pct(fav.total)}`);
    }
  }
  if (input.alerts.length) lines.push("", `⚠️ 注意 ${input.alerts.length} 件: ${input.alerts[0]}${input.alerts.length > 1 ? "（ほかはスコアカード）" : ""}`);
  const c = input.counts;
  lines.push("", `判定の内訳: BUY ${c.buy} / 様子見 ${c.watch} / 見送り ${c.skip}`);
  if (input.coverage && input.coverage.programs > 0) {
    const { programs, t5Races } = input.coverage;
    const short = c.total < programs * 0.9 || t5Races < programs * 0.9;
    lines.push(`記録できたレース: 判定 ${c.total}/${programs}・締切5分前のオッズ ${t5Races}/${programs}${short ? "（足りない分は PC のスリープや取得の失敗で記録なし）" : ""}`);
  } else {
    lines.push(`オッズ取得: ${c.oddsPresent}/${c.total}`);
  }
  lines.push(PAPER_NOTE);
  return { title, body: lines.join("\n") };
}

export type WeeklyWindow = {
  from: string;
  to: string;
  buys: BuyLedgerSummary;
  notified: number;
  decisionCoverage: number | null;
  t5Coverage: number | null;
  logLossGap: number | null;
};

export type WeeklySummaryInput = {
  thisWeek: WeeklyWindow;
  lastWeek: WeeklyWindow;
  /** 本命予想（各レース1点）の今週と先週の成績。 */
  favorite?: { thisWeek: BuyLedgerSummary; lastWeek: BuyLedgerSummary };
  /** 通算の成績（収支と回収率を出す）。 */
  total?: BuyLedgerSummary;
  knowledgeAdded: number;
  alerts: string[];
};

const trend = (now: number | null, before: number | null, higherIsBetter: boolean, eps: number) => {
  if (now == null || before == null) return "";
  if (Math.abs(now - before) < eps) return " →";
  return (now > before) === higherIsBetter ? " ↑" : " ↓";
};
const pct0 = (v: number | null) => (v == null ? "-" : `${Math.round(v * 100)}%`);

/** 月曜の週次まとめ。先週と比べて良くなったか（↑ 良くなった / ↓ 悪くなった / → 横ばい）を各行に付ける。 */
export function formatWeeklySummary(input: WeeklySummaryInput): { title: string; body: string } {
  const t = input.thisWeek, l = input.lastWeek;
  const share = (w: WeeklyWindow) => (w.buys.buys ? w.notified / w.buys.buys : null);
  const lines = [
    `成績: BUY ${t.buys.buys}件 → ${formatTally(t.buys)}`,
    `　先週: BUY ${l.buys.buys}件 → ${formatTally(l.buys)}`,
    ...(input.total ? [`通算: ${formatTallyMoney(input.total)}`] : []),
    ...(input.favorite && input.favorite.thisWeek.settled > 0
      ? [`⭐ 本命予想（各レース1点）: ${formatTallyMoney(input.favorite.thisWeek)}`, `　先週: ${formatTallyMoney(input.favorite.lastWeek)}`]
      : []),
    `締切前に通知できた BUY: ${t.buys.buys ? `${t.notified}/${t.buys.buys}` : "-"}（先週 ${l.buys.buys ? `${l.notified}/${l.buys.buys}` : "-"}）${trend(share(t), share(l), true, 0.05)}`,
    `オッズの収集（締切5分前の全120通り）: ${pct0(t.t5Coverage)}（先週 ${pct0(l.t5Coverage)}）${trend(t.t5Coverage, l.t5Coverage, true, 0.05)}`,
    `判定の記録: 番組の ${pct0(t.decisionCoverage)}（先週 ${pct0(l.decisionCoverage)}）${trend(t.decisionCoverage, l.decisionCoverage, true, 0.05)}`,
    t.logLossGap == null
      ? "確率の精度: 比べられるレースが足りない"
      : `確率の精度: v3 は市場補正より ${t.logLossGap.toFixed(3)} 不正確（先週 ${l.logLossGap == null ? "-" : l.logLossGap.toFixed(3)}、小さいほど良い）${trend(t.logLossGap, l.logLossGap, false, 0.002)}`,
    `知識: 今週 +${input.knowledgeAdded} 件（教訓・レビュー）`,
  ];
  if (input.alerts.length) lines.push("", `⚠️ 注意 ${input.alerts.length} 件: ${input.alerts[0]}${input.alerts.length > 1 ? "（ほかはスコアカード）" : ""}`);
  lines.push("", "↑ 良くなった / ↓ 悪くなった / → 横ばい", PAPER_NOTE);
  return { title: `📈 週次まとめ（${md(t.from)}〜${md(t.to)}）`, body: lines.join("\n") };
}
