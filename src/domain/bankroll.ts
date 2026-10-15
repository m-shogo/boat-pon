/**
 * 仮想の財布（2026-10-15、ユーザーの要望）: 1万円から始めて、締切前に届いた BUY を毎回 100 円ずつ買ったら、資産がどう動くか。
 * 買った時点で 100 円を払い、的中したら払戻を足す（結果待ちは払ったままにする。実際の財布と同じ）。購入の推奨ではない（paper）。
 *
 * 期（シーズン）: BUY の判定が変わったら（判定ロジック・app_settings・モデルの入れ替えなど）、新しい期を足して 1 万円からやり直す。
 * それまでは続ける。期を足すのは、判定を変えるコミットと同じときに行う（CLAUDE.md の「記録と検証のルール」）。
 */

export type BankrollSeason = {
  id: number;
  /** この日（JST）以降の BUY を数える。 */
  from: string;
  startYen: number;
  stakeYen: number;
  /** 何が変わってこの期が始まったか。 */
  note: string;
};

export const BANKROLL_SEASONS: readonly BankrollSeason[] = [
  { id: 1, from: "2026-10-10", startYen: 10_000, stakeYen: 100, note: "判定を締め切りで固定した後の v3 の BUY（締切前に届いたものを全部買う）" },
];

export function currentSeason(today: string, seasons: readonly BankrollSeason[] = BANKROLL_SEASONS): BankrollSeason {
  const started = seasons.filter((s) => s.from <= today);
  return started.length ? started[started.length - 1] : seasons[0];
}

/** 1回の BUY。order は時刻の順（日付・締切）に並べるための文字列。hit は null なら結果待ち。 */
export type BankrollBet = { order: string; date: string; hit: boolean | null; payoutYen: number | null };

export type Bankroll = {
  season: BankrollSeason;
  balanceYen: number;
  /** 期の始まりからの増減。 */
  changeYen: number;
  peakYen: number;
  troughYen: number;
  bets: number;
  hits: number;
  pending: number;
  /** 指定した日（その日の終わり）時点の資産。週次まとめの「先週末」用。 */
  balanceAt: (date: string) => number;
};

export function computeBankroll(bets: BankrollBet[], season: BankrollSeason): Bankroll {
  const sorted = bets.filter((b) => b.date >= season.from).sort((a, b) => a.order.localeCompare(b.order));
  let balance = season.startYen, peak = balance, trough = balance, hits = 0, pending = 0;
  const balanceByDate = new Map<string, number>();
  for (const bet of sorted) {
    balance -= season.stakeYen;
    if (bet.hit == null) pending += 1;
    else if (bet.hit) { hits += 1; balance += bet.payoutYen ?? 0; }
    peak = Math.max(peak, balance);
    trough = Math.min(trough, balance);
    balanceByDate.set(bet.date, balance);
  }
  const dates = [...balanceByDate.keys()].sort();
  return {
    season,
    balanceYen: balance,
    changeYen: balance - season.startYen,
    peakYen: peak,
    troughYen: trough,
    bets: sorted.length,
    hits,
    pending,
    balanceAt: (date) => {
      const last = dates.filter((d) => d <= date).pop();
      return last ? balanceByDate.get(last)! : season.startYen;
    },
  };
}

const yen = (v: number) => `${v.toLocaleString("ja-JP")}円`;
const signed = (v: number) => `${v >= 0 ? "+" : "-"}${Math.abs(v).toLocaleString("ja-JP")}円`;

/** 「💴 資産 8,700円（1万円スタートから -1,300円）」の1行。 */
export function formatBankrollLine(b: Bankroll): string {
  const pending = b.pending ? `・結果待ち ${b.pending}件` : "";
  return `💴 資産 ${yen(b.balanceYen)}（第${b.season.id}期 ${yen(b.season.startYen)}スタートから ${signed(b.changeYen)}・最高 ${yen(b.peakYen)}・最低 ${yen(b.troughYen)}・${b.bets}回 ${b.hits}的中${pending}）`;
}
