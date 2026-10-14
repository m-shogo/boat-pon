import type { BuyLedgerSummary } from "./accuracyScorecard";

export type BuyResultNotificationInput = {
  venue: string;
  raceNo: number;
  betType: string;
  selection: string;
  resultSelection: string | null;
  winningPayoutYen: number | null;
  returned: boolean;
  currentOdds: number | null;
  /** 今月と通算の成績（100円ずつ買った場合）。渡すと2行目に出す。 */
  tally?: { month?: BuyLedgerSummary; total?: BuyLedgerSummary };
};

export type BuyResultNotificationMessage = {
  title: string;
  body: string;
  status: "hit" | "miss" | "returned";
};

const yen = (value: number) => `${value.toLocaleString("ja-JP")}円`;
const signedYen = (value: number) => `${value >= 0 ? "+" : "-"}${Math.abs(value).toLocaleString("ja-JP")}円`;

/** 成績を「n勝 m敗（±円）」で表す。100円ずつ買った場合の収支。 */
export function formatTally(ledger: BuyLedgerSummary): string {
  const payout = Math.round((ledger.officialRoi ?? 0) * ledger.settled * 100);
  return `${ledger.hits}勝 ${ledger.misses}敗（${signedYen(payout - ledger.settled * 100)}）`;
}

/**
 * BUY の結果の通知。1行目（見出し）だけで「当たったか・いくらか」がわかるようにする。
 * 絵文字は種類ごとに固定する: 的中 ✅ / はずれ ❌ / 返還 ↩️（BUY の通知は 🔔。🎯 は使わない）。
 * 「実着順: X」の行は、速報と確定の重複を見分けるキーにも使うので、形を変えない。
 */
export function buildBuyResultNotification(input: BuyResultNotificationInput): BuyResultNotificationMessage {
  const status = input.returned
    ? "returned"
    : input.resultSelection === input.selection ? "hit" : "miss";
  const race = `${input.venue}${input.raceNo}R`;
  const result = input.resultSelection ?? (input.returned ? "返還" : "未確定");
  const payout = input.winningPayoutYen;

  const title = status === "hit"
    ? `✅ 的中！ ${race} ${input.selection} → 払戻 ${payout == null ? "不明" : yen(payout)}`
    : status === "miss"
      ? `❌ はずれ ${race}（買い目 ${input.selection} → 結果 ${result}）`
      : `↩️ 返還 ${race}（100円が戻る）`;

  const outcomeLine = status === "hit"
    ? `100円が ${payout == null ? "不明" : yen(payout)} に（${payout == null ? "-" : signedYen(payout - 100)}）`
    : status === "miss"
      ? `-100円（結果の組 ${result} の払戻は ${payout == null ? "不明" : yen(payout)}）`
      : "±0円";
  const tallyParts = [
    input.tally?.month ? `今月 ${formatTally(input.tally.month)}` : null,
    input.tally?.total ? `通算 ${formatTally(input.tally.total)}` : null,
  ].filter(Boolean);

  return {
    status,
    title,
    body: [
      outcomeLine,
      tallyParts.length ? tallyParts.join(" / ") : null,
      "",
      `買い目: ${input.selection}（${input.betType}）`,
      `実着順: ${result}`,
      `BUY のときのオッズ: ${input.currentOdds == null ? "未取得" : `${input.currentOdds.toFixed(1)}倍`}`,
      "※paper検証（実際の購入なし）",
    ].filter((line): line is string => line != null).join("\n"),
  };
}
