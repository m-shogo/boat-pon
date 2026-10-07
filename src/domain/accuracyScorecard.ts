/**
 * 精度スコアカードの計算部品。当たり外れの台帳と、確率の精度（v3 と市場補正確率の比較）を出す。
 * 市場補正の定数は 2026-10-07 に事前登録して 7〜8月で学習した値（scripts/review-20261007-late-money.ts）。
 * forward（9〜10月）では logloss が市場をわずかに上回ったが、EV ベットは不合格。精度の基準としてだけ使う。
 */

export const MARKET_CALIBRATION = { temperature: 0.9, lateMoneyBeta: 0.25 } as const;

export type BinaryPrediction = { p: number; hit: 0 | 1 };

export type BinaryMetrics = {
  n: number;
  hits: number;
  expectedHits: number;
  actualToPredicted: number | null;
  brier: number | null;
  logLoss: number | null;
};

export function binaryMetrics(rows: BinaryPrediction[]): BinaryMetrics {
  if (!rows.length) return { n: 0, hits: 0, expectedHits: 0, actualToPredicted: null, brier: null, logLoss: null };
  let brier = 0, logLoss = 0, expected = 0, hits = 0;
  for (const row of rows) {
    const p = Math.min(Math.max(row.p, 1e-6), 1 - 1e-6);
    brier += (p - row.hit) ** 2;
    logLoss += -(row.hit ? Math.log(p) : Math.log(1 - p));
    expected += p;
    hits += row.hit;
  }
  return {
    n: rows.length,
    hits,
    expectedHits: expected,
    actualToPredicted: expected > 0 ? hits / expected : null,
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
  };
}

/** 払戻倍率（odds）から控除分を除いた市場確率。不正なオッズが1つでもあれば null。 */
export function normalizedMarketProbabilities(odds: Map<string, number>): Map<string, number> | null {
  if (!odds.size || [...odds.values()].some((value) => !(value > 1) || !Number.isFinite(value))) return null;
  let total = 0;
  for (const value of odds.values()) total += 1 / value;
  return new Map([...odds].map(([selection, value]) => [selection, 1 / value / total]));
}

/**
 * T-5 市場確率に temperature と late money（直前の確率変化）を掛けて正規化する。
 * 直前のスナップショットが無いときは late money 項を使わない。
 */
export function calibratedMarketProbabilities(
  t5Odds: Map<string, number>,
  earlierOdds: Map<string, number> | null,
  options: { temperature: number; lateMoneyBeta: number } = MARKET_CALIBRATION,
): Map<string, number> | null {
  const p5 = normalizedMarketProbabilities(t5Odds);
  if (!p5) return null;
  const prev = earlierOdds ? normalizedMarketProbabilities(earlierOdds) : null;
  const weights = new Map<string, number>();
  let total = 0;
  for (const [selection, p] of p5) {
    const earlier = prev?.get(selection);
    const momentum = earlier != null && earlier > 0 ? Math.log(p) - Math.log(earlier) : 0;
    const weight = Math.pow(p, 1 / options.temperature) * Math.exp(options.lateMoneyBeta * momentum);
    weights.set(selection, weight);
    total += weight;
  }
  return new Map([...weights].map(([selection, weight]) => [selection, weight / total]));
}

export type BuyOutcome = { date: string; hit: boolean | null; payoutYen: number | null };

export type BuyLedgerSummary = {
  buys: number;
  settled: number;
  hits: number;
  misses: number;
  officialRoi: number | null;
  byMonth: Array<{ month: string; buys: number; settled: number; hits: number; officialRoi: number | null }>;
};

/** hit=null は未精算（結果未取得または返還）。ROI は精算済みだけを分母にする（100円ベット）。 */
export function summarizeBuyLedger(rows: BuyOutcome[]): BuyLedgerSummary {
  const months = new Map<string, { buys: number; settled: number; hits: number; payout: number }>();
  let settled = 0, hits = 0, payout = 0;
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    const bucket = months.get(month) ?? { buys: 0, settled: 0, hits: 0, payout: 0 };
    bucket.buys += 1;
    if (row.hit != null) {
      bucket.settled += 1;
      settled += 1;
      if (row.hit) {
        bucket.hits += 1;
        hits += 1;
        bucket.payout += row.payoutYen ?? 0;
        payout += row.payoutYen ?? 0;
      }
    }
    months.set(month, bucket);
  }
  return {
    buys: rows.length,
    settled,
    hits,
    misses: settled - hits,
    officialRoi: settled ? payout / (settled * 100) : null,
    byMonth: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, b]) => ({
      month, buys: b.buys, settled: b.settled, hits: b.hits, officialRoi: b.settled ? b.payout / (b.settled * 100) : null,
    })),
  };
}
