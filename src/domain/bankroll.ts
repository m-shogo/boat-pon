/**
 * 仮想の財布（2026-10-15、ユーザーの要望）: 1万円から始めて、締切前に届いた BUY を毎回 100 円ずつ買ったら、資産がどう動くか。
 * 買った時点で 100 円を払い、的中したら払戻を足す。返還なら 100 円が戻る。結果待ちは払ったままにする（実際の財布と同じ）。
 * 0 円を割っても止めずに数える（マイナスで表示する。ユーザーの要望「マイナスになってもいい」）。購入の推奨ではない（paper）。
 *
 * 財布は BUY の「代」ごとに分ける（2026-10-15、ユーザーの要望「昔と最新で財布を分けて、わかりやすい名前を」）。
 * BUY の判定が変わったら（判定ロジック・app_settings・モデルの入れ替えなど）、WALLETS に次の代を足す。いまの代は前の日で
 * 引退し（⚓ 最後の資産のまま残す）、次の代（🚤 現役）が 1 万円から始まる。代を足すのは、判定を変えるコミットと同じときに行う
 * （CLAUDE.md の「記録と検証のルール」）。
 */

export type Wallet = {
  /** 何代目か（1 = 初代）。 */
  generation: number;
  /** この日（JST）以降の BUY を数える。次の代の from の前の日までがこの代。 */
  from: string;
  startYen: number;
  stakeYen: number;
  /** どんな BUY の代か（何が変わってこの代が始まったか）。 */
  note: string;
};

export const WALLETS: readonly Wallet[] = [
  { generation: 1, from: "2026-07-20", startYen: 10_000, stakeYen: 100, note: "締切の後も判定を上書きしていたころの v3 の BUY（締切前に届いた分だけ数える）" },
  { generation: 2, from: "2026-10-10", startYen: 10_000, stakeYen: 100, note: "判定を締め切りで固定した後の v3 の BUY" },
];

export const walletName = (generation: number) => (generation === 1 ? "初代" : `${generation}代目`);

/** 1回の BUY。order は時刻の順（日付・締切）に並べるための文字列。hit は null なら結果待ち。returned は返還（100 円が戻る）。 */
export type BankrollBet = { order: string; date: string; hit: boolean | null; payoutYen: number | null; returned?: boolean };

export type Bankroll = {
  wallet: Wallet;
  /** 最後の日（引退した代だけ。現役は null）。 */
  to: string | null;
  retired: boolean;
  balanceYen: number;
  /** 代の始まりからの増減。 */
  changeYen: number;
  peakYen: number;
  troughYen: number;
  bets: number;
  hits: number;
  returns: number;
  pending: number;
  /** 指定した日（その日の終わり）時点の資産。週次まとめの「先週末」用。 */
  balanceAt: (date: string) => number;
};

const previousDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** today に始まっている代を古い順に（最後が現役）。 */
export function startedWallets(today: string, wallets: readonly Wallet[] = WALLETS): Wallet[] {
  const started = wallets.filter((w) => w.from <= today);
  return started.length ? started : [wallets[0]];
}

export function computeBankroll(bets: BankrollBet[], wallet: Wallet, to: string | null = null): Bankroll {
  const sorted = bets
    .filter((b) => b.date >= wallet.from && (to == null || b.date <= to))
    .sort((a, b) => a.order.localeCompare(b.order));
  let balance = wallet.startYen, peak = balance, trough = balance, hits = 0, returns = 0, pending = 0;
  const balanceByDate = new Map<string, number>();
  for (const bet of sorted) {
    // 買った時点で払う（最低の資産は、払戻を足す前のこの時点で見る）
    balance -= wallet.stakeYen;
    trough = Math.min(trough, balance);
    if (bet.returned) { returns += 1; balance += wallet.stakeYen; }
    else if (bet.hit == null) pending += 1;
    else if (bet.hit) { hits += 1; balance += bet.payoutYen ?? 0; }
    peak = Math.max(peak, balance);
    balanceByDate.set(bet.date, balance);
  }
  const dates = [...balanceByDate.keys()].sort();
  return {
    wallet,
    to,
    retired: to != null,
    balanceYen: balance,
    changeYen: balance - wallet.startYen,
    peakYen: peak,
    troughYen: trough,
    bets: sorted.length,
    hits,
    returns,
    pending,
    balanceAt: (date) => {
      const last = dates.filter((d) => d <= date).pop();
      return last ? balanceByDate.get(last)! : wallet.startYen;
    },
  };
}

/** 始まっている全部の代の財布（古い順・最後が現役）。BUY はそれぞれの代の期間だけで数える。 */
export function computeWallets(bets: BankrollBet[], today: string, wallets: readonly Wallet[] = WALLETS): Bankroll[] {
  const started = startedWallets(today, wallets);
  return started.map((wallet, i) => computeBankroll(bets, wallet, i + 1 < started.length ? previousDay(started[i + 1].from) : null));
}

const yen = (v: number) => `${v.toLocaleString("ja-JP")}円`;
const signed = (v: number) => `${v >= 0 ? "+" : "-"}${Math.abs(v).toLocaleString("ja-JP")}円`;
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 「🚤 2代目（現役）」「⚓ 初代（引退）」。 */
export const walletLabel = (b: Bankroll) => `${b.retired ? "⚓" : "🚤"} ${walletName(b.wallet.generation)}（${b.retired ? "引退" : "現役"}）`;

const record = (b: Bankroll) =>
  `${b.bets}回 ${b.hits}的中${b.returns ? `・返還 ${b.returns}件` : ""}${b.pending ? `・結果待ち ${b.pending}件` : ""}`;

/** 日次まとめの2行: 「🚤 2代目（現役・10/10〜）: 9,100円（1万円から -900円）」と、回数・最高・最低。 */
export function formatWalletLines(b: Bankroll): string[] {
  const period = `${md(b.wallet.from)}〜${b.to ? md(b.to) : ""}`;
  return [
    `${walletLabel(b).replace("）", `・${period}）`)}: ${yen(b.balanceYen)}（${yen(b.wallet.startYen)}から ${signed(b.changeYen)}）`,
    `　${record(b)}／最高 ${yen(b.peakYen)}・最低 ${yen(b.troughYen)}`,
  ];
}

/** 結果の通知に付ける1行: 「🚤 2代目の財布: 9,100円（10,000円から -900円・9回 0的中・結果待ち 2件）」。 */
export function formatBankrollLine(b: Bankroll): string {
  return `${b.retired ? "⚓" : "🚤"} ${walletName(b.wallet.generation)}の財布${b.retired ? "（引退）" : ""}: ${yen(b.balanceYen)}（${yen(b.wallet.startYen)}から ${signed(b.changeYen)}・${record(b)}）`;
}

/** その日の BUY を数える代の財布（結果の通知で、BUY が属する代を出す）。代が始まる前の日なら null。 */
export function walletFor(wallets: Bankroll[], date: string): Bankroll | null {
  return wallets.find((b) => b.wallet.from <= date && (b.to == null || date <= b.to)) ?? null;
}
