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

// ─── 改善の自動化: 市場補正パラメータの挑戦者評価 ───

export type MarketCalibration = { temperature: number; lateMoneyBeta: number };
export type MarketRace = { date: string; winner: string; t5Odds: Map<string, number>; earlierOdds: Map<string, number> | null };

/** 1レースごとに「勝った買い目に付けた確率」の -log を平均する（120通り全体の多クラス logloss）。 */
export function multiclassLogLoss(races: MarketRace[], params: MarketCalibration): number | null {
  let total = 0, n = 0;
  for (const race of races) {
    const p = calibratedMarketProbabilities(race.t5Odds, race.earlierOdds, params);
    if (!p || !p.has(race.winner)) continue;
    total += -Math.log(Math.max(p.get(race.winner)!, 1e-12));
    n += 1;
  }
  return n ? total / n : null;
}

export const CALIBRATION_GRID = {
  temperatures: [0.8, 0.85, 0.9, 0.95, 1],
  lateMoneyBetas: [0, 0.1, 0.25, 0.4, 0.6],
} as const;

export function fitMarketCalibration(races: MarketRace[], grid = CALIBRATION_GRID): MarketCalibration & { logLoss: number | null } {
  let best: MarketCalibration & { logLoss: number | null } = { ...MARKET_CALIBRATION, logLoss: null };
  for (const temperature of grid.temperatures) {
    for (const lateMoneyBeta of grid.lateMoneyBetas) {
      const logLoss = multiclassLogLoss(races, { temperature, lateMoneyBeta });
      if (logLoss != null && (best.logLoss == null || logLoss < best.logLoss)) best = { temperature, lateMoneyBeta, logLoss };
    }
  }
  return best;
}

/**
 * 事前登録した入れ替え条件（2026-10-08）:
 * 評価期間（学習に使っていない直近4週）の logloss で、挑戦者が王者より 0.002 以上良く、
 * かつ 50レース以上ある週のうち4週中3週以上で勝つこと。どちらかを欠けば王者を据え置く。
 */
export const PROMOTION_RULE = { minImprovement: 0.002, minWeeklyWins: 3, minRacesPerWeek: 50 } as const;

export function evaluateChallenger(champion: MarketCalibration, challenger: MarketCalibration, weeklyBlocks: MarketRace[][]) {
  const pooled = weeklyBlocks.flat();
  const championLogLoss = multiclassLogLoss(pooled, champion);
  const challengerLogLoss = multiclassLogLoss(pooled, challenger);
  let weeklyWins = 0, eligibleWeeks = 0;
  for (const block of weeklyBlocks) {
    if (block.length < PROMOTION_RULE.minRacesPerWeek) continue;
    eligibleWeeks += 1;
    const a = multiclassLogLoss(block, champion), b = multiclassLogLoss(block, challenger);
    if (a != null && b != null && b < a) weeklyWins += 1;
  }
  const improvement = championLogLoss != null && challengerLogLoss != null ? championLogLoss - challengerLogLoss : null;
  const promote = improvement != null && improvement >= PROMOTION_RULE.minImprovement && weeklyWins >= PROMOTION_RULE.minWeeklyWins;
  return { races: pooled.length, championLogLoss, challengerLogLoss, improvement, weeklyWins, eligibleWeeks, promote };
}

// ─── LINE の文面 ───

export type AccuracySnapshot = {
  generatedAt: string;
  v3LogLoss: number | null;
  calibratedLogLoss: number | null;
  v3BuyActualToPredicted: number | null;
};

/** スコアカード JSON から LINE に載せる精度の要点だけを取り出す。形が合わなければ null。 */
export function accuracySnapshotFromReport(report: unknown): AccuracySnapshot | null {
  if (!report || typeof report !== "object") return null;
  const r = report as { generatedAt?: unknown; accuracy?: { all?: Array<{ key?: string; metrics?: BinaryMetrics }>; buyOnly?: Array<{ key?: string; metrics?: BinaryMetrics }> } };
  if (typeof r.generatedAt !== "string" || !Array.isArray(r.accuracy?.all) || !Array.isArray(r.accuracy?.buyOnly)) return null;
  const pick = (rows: Array<{ key?: string; metrics?: BinaryMetrics }>, key: string) => rows.find((row) => row.key === key)?.metrics ?? null;
  return {
    generatedAt: r.generatedAt,
    v3LogLoss: pick(r.accuracy.all, "v3")?.logLoss ?? null,
    calibratedLogLoss: pick(r.accuracy.all, "calibrated")?.logLoss ?? null,
    v3BuyActualToPredicted: pick(r.accuracy.buyOnly, "v3")?.actualToPredicted ?? null,
  };
}

const pctText = (value: number | null) => (value == null ? "-" : `${(value * 100).toFixed(1)}%`);

/** 日次まとめに足す「当たり外れ」と「精度」の行。精度は 48時間以内のスコアカードだけを使う。 */
export function formatLedgerAndAccuracyLines(ledger: BuyLedgerSummary, accuracy: AccuracySnapshot | null, now: Date): string[] {
  const pending = ledger.buys - ledger.settled;
  const lines = [`当たり外れ累計: BUY ${ledger.buys} / 的中 ${ledger.hits} / 外れ ${ledger.misses}${pending ? ` / 結果待ち ${pending}` : ""} / ROI ${pctText(ledger.officialRoi)}（公式払戻）`];
  const fresh = accuracy && now.getTime() - Date.parse(accuracy.generatedAt) <= 48 * 3600_000;
  if (fresh && accuracy) {
    const ratio = accuracy.v3BuyActualToPredicted;
    const ratioText = ratio == null ? "-" : `${ratio.toFixed(2)}（1 が正確）`;
    const ll = (value: number | null) => (value == null ? "-" : value.toFixed(3));
    lines.push(`精度: BUY の的中 実績/予測 = ${ratioText} / logloss v3 ${ll(accuracy.v3LogLoss)}・市場補正 ${ll(accuracy.calibratedLogLoss)}（小さいほど正確）`);
  }
  return lines;
}

/** BUY 通知に足す1行。v3 の推定と、市場補正の確率・期待回収率（判定時オッズ基準）を並べる。 */
export function describeBuyProbability(args: {
  selection: string;
  v3HitRate: number | null;
  quoteOdds: number | null;
  latestOdds: Map<string, number>;
  earlierOdds: Map<string, number> | null;
  params?: MarketCalibration;
}): string | null {
  const p = calibratedMarketProbabilities(args.latestOdds, args.earlierOdds, args.params ?? MARKET_CALIBRATION)?.get(args.selection);
  if (p == null) return null;
  const expected = args.quoteOdds != null ? ` / 期待回収 ${(p * args.quoteOdds).toFixed(2)}` : "";
  const v3 = args.v3HitRate != null ? `v3 ${(args.v3HitRate * 100).toFixed(1)}% → ` : "";
  return `的中確率: ${v3}市場補正 ${(p * 100).toFixed(1)}%${expected}`;
}

// ─── 監視: 「成功」の表示ではなく中身で止まりを見つける ───

export type DataFreshnessInput = { today: string; resultsMaxDate: string | null; payoutsMaxDate: string | null; programsMaxDate: string | null };

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00+09:00`) - Date.parse(`${from}T00:00:00+09:00`)) / 86_400_000);

/**
 * 結果は公式アーカイブの公開待ちで 1〜2 日遅れるのが普通なので、3日を超えたら警告する。
 * 全券種の払戻は結果と同じ K ファイルから入るので、結果より 2 日以上遅れたら止まっている。
 * 番組表は当日の朝に入るので、今日の分が無ければ警告する。
 */
export function evaluateDataFreshness(input: DataFreshnessInput): string[] {
  const alerts: string[] = [];
  if (!input.resultsMaxDate || daysBetween(input.resultsMaxDate, input.today) > 3) alerts.push(`レース結果の最終日が ${input.resultsMaxDate ?? "なし"}（3日を超えて遅れている）`);
  if (input.resultsMaxDate && (!input.payoutsMaxDate || daysBetween(input.payoutsMaxDate, input.resultsMaxDate) >= 2)) {
    alerts.push(`全券種の払戻（race_payouts）の最終日が ${input.payoutsMaxDate ?? "なし"}（結果は ${input.resultsMaxDate} まであるのに止まっている）`);
  }
  if (!input.programsMaxDate || input.programsMaxDate < input.today) alerts.push(`番組表の最終日が ${input.programsMaxDate ?? "なし"}（今日の分が無い）`);
  return alerts;
}

export type JobLivenessInput = { job: string; ageMinutes: number | null; maxAgeMinutes: number; optional?: boolean };

/** ログの最終更新からの経過時間で、ジョブが動いているかを判定する。optional はログが無ければ未登録とみなして警告しない。 */
export function evaluateJobLiveness(jobs: JobLivenessInput[]) {
  const rows = jobs.map((job) => {
    const status = job.ageMinutes == null ? (job.optional ? "未登録" : "ログなし") : job.ageMinutes > job.maxAgeMinutes ? "停止の疑い" : "稼働";
    return { ...job, status };
  });
  const alerts = rows
    .filter((row) => row.status === "停止の疑い" || row.status === "ログなし")
    .map((row) => (row.ageMinutes == null ? `ジョブ ${row.job} のログが無い` : `ジョブ ${row.job} が ${(row.ageMinutes / 60).toFixed(1)} 時間動いていない（想定は ${(row.maxAgeMinutes / 60).toFixed(1)} 時間以内）`));
  return { rows, alerts };
}
