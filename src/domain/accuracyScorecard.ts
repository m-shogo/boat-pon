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
/** オッズ帯（1〜10 / 10〜20 / 20〜50 / 50〜100 / 100〜300 / 300〜）。本命・大穴の偏りを帯ごとの重みで直すときに使う。 */
export const ODDS_BAND_EDGES = [1, 10, 20, 50, 100, 300] as const;

export function oddsBandIndex(odds: number): number {
  let index = 0;
  for (let i = 0; i < ODDS_BAND_EDGES.length; i += 1) if (odds >= ODDS_BAND_EDGES[i]) index = i;
  return index;
}

export function calibratedMarketProbabilities(
  t5Odds: Map<string, number>,
  earlierOdds: Map<string, number> | null,
  options: { temperature: number; lateMoneyBeta: number; oddsBandWeights?: readonly number[] } = MARKET_CALIBRATION,
): Map<string, number> | null {
  const p5 = normalizedMarketProbabilities(t5Odds);
  if (!p5) return null;
  const prev = earlierOdds ? normalizedMarketProbabilities(earlierOdds) : null;
  const weights = new Map<string, number>();
  let total = 0;
  for (const [selection, p] of p5) {
    const earlier = prev?.get(selection);
    const momentum = earlier != null && earlier > 0 ? Math.log(p) - Math.log(earlier) : 0;
    const bandWeight = options.oddsBandWeights ? options.oddsBandWeights[oddsBandIndex(t5Odds.get(selection)!)] ?? 1 : 1;
    const weight = Math.pow(p, 1 / options.temperature) * Math.exp(options.lateMoneyBeta * momentum) * bandWeight;
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

export type MarketCalibration = { temperature: number; lateMoneyBeta: number; oddsBandWeights?: readonly number[] };
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
 * オッズ帯ごとの重み（実際の的中数 ÷ 補正後の期待的中数）。帯ごとの件数が少ないときに暴れないよう、prior 分の事前値 1 で縮める。
 */
export function fitOddsBandWeights(races: MarketRace[], base: MarketCalibration, prior = 30): number[] {
  const expected = new Array(ODDS_BAND_EDGES.length).fill(0);
  const actual = new Array(ODDS_BAND_EDGES.length).fill(0);
  for (const race of races) {
    const p = calibratedMarketProbabilities(race.t5Odds, race.earlierOdds, { temperature: base.temperature, lateMoneyBeta: base.lateMoneyBeta });
    if (!p) continue;
    for (const [selection, q] of p) {
      const band = oddsBandIndex(race.t5Odds.get(selection)!);
      expected[band] += q;
      if (selection === race.winner) actual[band] += 1;
    }
  }
  return expected.map((e, band) => Number(((actual[band] + prior) / (e + prior)).toFixed(4)));
}

export type ChallengerCandidate = { family: "temperature-late-money" | "with-odds-bands"; params: MarketCalibration; trainLogLoss: number | null };

/**
 * 挑戦者の候補を作る。(1) temperature・late money の格子探索、(2) それにオッズ帯の重みを足したもの。
 * 学習期間の logloss が小さい方を挑戦者にする（学習期間では (2) が有利なので、本当に効くかは評価期間の入れ替え条件で決める）。
 */
export function fitChallengers(races: MarketRace[]): { best: ChallengerCandidate; candidates: ChallengerCandidate[] } {
  const grid = fitMarketCalibration(races);
  const base: MarketCalibration = { temperature: grid.temperature, lateMoneyBeta: grid.lateMoneyBeta };
  const withBands: MarketCalibration = { ...base, oddsBandWeights: fitOddsBandWeights(races, base) };
  const candidates: ChallengerCandidate[] = [
    { family: "temperature-late-money", params: base, trainLogLoss: grid.logLoss },
    { family: "with-odds-bands", params: withBands, trainLogLoss: multiclassLogLoss(races, withBands) },
  ];
  const best = [...candidates].sort((a, b) => (a.trainLogLoss ?? Infinity) - (b.trainLogLoss ?? Infinity))[0];
  return { best, candidates };
}

/** パラメータの表示用の短い説明。 */
export function describeCalibration(params: MarketCalibration): string {
  const bands = params.oddsBandWeights ? ` + オッズ帯補正[${params.oddsBandWeights.map((w) => w.toFixed(2)).join(",")}]` : "";
  return `T=${params.temperature}・β=${params.lateMoneyBeta}${bands}`;
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
  alerts: string[];
};

/** スコアカード JSON から LINE に載せる精度の要点だけを取り出す。形が合わなければ null。 */
export function accuracySnapshotFromReport(report: unknown): AccuracySnapshot | null {
  if (!report || typeof report !== "object") return null;
  const r = report as { generatedAt?: unknown; alerts?: unknown; accuracy?: { all?: Array<{ key?: string; metrics?: BinaryMetrics }>; buyOnly?: Array<{ key?: string; metrics?: BinaryMetrics }> } };
  if (typeof r.generatedAt !== "string" || !Array.isArray(r.accuracy?.all) || !Array.isArray(r.accuracy?.buyOnly)) return null;
  const pick = (rows: Array<{ key?: string; metrics?: BinaryMetrics }>, key: string) => rows.find((row) => row.key === key)?.metrics ?? null;
  return {
    generatedAt: r.generatedAt,
    v3LogLoss: pick(r.accuracy.all, "v3")?.logLoss ?? null,
    calibratedLogLoss: pick(r.accuracy.all, "calibrated")?.logLoss ?? null,
    v3BuyActualToPredicted: pick(r.accuracy.buyOnly, "v3")?.actualToPredicted ?? null,
    alerts: Array.isArray(r.alerts) ? r.alerts.filter((a): a is string => typeof a === "string") : [],
  };
}

const pctText = (value: number | null) => (value == null ? "-" : `${(value * 100).toFixed(1)}%`);

/**
 * 日次まとめに足す「当たり外れ」と「精度」の行。精度は 48時間以内のスコアカードだけを使う。
 * notifiedLedger（締切前に通知できた BUY だけの台帳）を渡すと、行動できた分の成績を別の行で出す。
 */
export function formatLedgerAndAccuracyLines(ledger: BuyLedgerSummary, accuracy: AccuracySnapshot | null, now: Date, notifiedLedger?: BuyLedgerSummary): string[] {
  const pending = ledger.buys - ledger.settled;
  const lines = [`当たり外れ累計: BUY ${ledger.buys} / 的中 ${ledger.hits} / 外れ ${ledger.misses}${pending ? ` / 結果待ち ${pending}` : ""} / ROI ${pctText(ledger.officialRoi)}（公式払戻）`];
  if (notifiedLedger) {
    lines.push(`うち締切前に通知できた BUY: ${notifiedLedger.buys} 件・的中 ${notifiedLedger.hits} / ROI ${pctText(notifiedLedger.officialRoi)}（残り ${ledger.buys - notifiedLedger.buys} 件は締切後に BUY 判定）`);
  }
  const fresh = accuracy && now.getTime() - Date.parse(accuracy.generatedAt) <= 48 * 3600_000;
  if (fresh && accuracy) {
    const ratio = accuracy.v3BuyActualToPredicted;
    const ratioText = ratio == null ? "-" : `${ratio.toFixed(2)}（1 が正確）`;
    const ll = (value: number | null) => (value == null ? "-" : value.toFixed(3));
    lines.push(`精度: BUY の的中 実績/予測 = ${ratioText} / logloss v3 ${ll(accuracy.v3LogLoss)}・市場補正 ${ll(accuracy.calibratedLogLoss)}（小さいほど正確）`);
    // 「成功と出ているのに中身が止まっている」をスマホで翌日に気づけるよう、スコアカードの注意も載せる。
    if (accuracy.alerts.length > 0) lines.push(`⚠️ 注意 ${accuracy.alerts.length} 件: ${accuracy.alerts[0]}${accuracy.alerts.length > 1 ? "（ほかは公開版スコアカード）" : ""}`);
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

// ─── BUY を「実際に知らせられたか」で分ける ───
// 2026-10-08 の調査: BUY 178件のうち締切前に通知できたのは 32件（0的中）。
// 直前情報が締切後に届くと、締切後の再評価で BUY のラベルだけが付く（94件）。行動できた記録と区別して数える。

export type BuyTimingKind = "notified" | "info-after-close" | "no-info" | "not-notified";

export const BUY_TIMING_LABEL: Record<BuyTimingKind, string> = {
  "notified": "締切前に通知できた",
  "info-after-close": "直前情報が締切後に届いた（締切後に BUY 判定）",
  "no-info": "直前情報なし",
  "not-notified": "締切前に情報はあったが通知なし",
};

/** SQLite の CURRENT_TIMESTAMP（UTC・"YYYY-MM-DD HH:MM:SS"）と ISO 文字列の両方を読む。 */
export function parseDbTimestamp(value: string | null): number | null {
  if (!value) return null;
  const iso = /[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function classifyBuyTiming(args: { date: string; closeAt: string | null; sentAt: string | null; infoAt: string | null }): BuyTimingKind {
  if (!args.closeAt) return "not-notified";
  const close = Date.parse(`${args.date}T${args.closeAt}:00+09:00`);
  const sent = parseDbTimestamp(args.sentAt);
  if (sent != null && sent < close) return "notified";
  const info = parseDbTimestamp(args.infoAt);
  if (info == null) return "no-info";
  return info >= close ? "info-after-close" : "not-notified";
}
