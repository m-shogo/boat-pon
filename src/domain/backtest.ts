import type { DecisionStatus } from "./types";
import type { OvervaluationRow } from "./analysis";

export type DecisionHistoryRow = {
  id: number;
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  selection: string;
  estimatedHitRate: number;
  requiredOdds: number;
  currentOdds: number | null;
  ev: number | null;
  decision: DecisionStatus;
  actuallyBought: boolean;
  stakeYen: number;
  recommendedStakeYen: number;
  sampleSize: number;
  modelVersion?: string | null;
  raceCategory?: string | null;
  result: string | null;
  payoutYen: number | null;
  popularity: number | null;
  returned: boolean;
  source: string;
  fetchedAt: string;
  createdAt: string;
};

export type BacktestSummary = {
  decisions: number;
  buy: number;
  watch: number;
  skip: number;
  bought: number;
  totalStakeYen: number;
  totalPayoutYen: number;
  modelStakeYen: number;
  modelPayoutYen: number;
  modelRoi: number;
  hits: number;
  hitRate: number;
  roi: number;
  excludedSampleShort: number;
  validDecisions: number;
  validBuy: number;
  validHits: number;
  validHitRate: number;
  validModelStakeYen: number;
  validModelPayoutYen: number;
  validModelRoi: number;
  byDecision: Array<{
    decision: DecisionStatus;
    count: number;
    stakeYen: number;
    payoutYen: number;
    roi: number;
    modelStakeYen: number;
    modelPayoutYen: number;
    modelRoi: number;
  }>;
  overvaluation: OvervaluationRow[];
  byVenue: Array<{
    venue: string;
    count: number;
    buy: number;
    stakeYen: number;
    payoutYen: number;
    roi: number;
    modelStakeYen: number;
    modelPayoutYen: number;
    modelRoi: number;
  }>;
};

export type MonthlySummary = {
  ym: string;
  decisions: number;
  buy: number;
  bought: number;
  hits: number;
  hitRate: number;
  modelStakeYen: number;
  modelPayoutYen: number;
  modelRoi: number;
  daysActive: number;
  noBuyDays: number;
};

export type PeriodSplit = {
  train: DecisionHistoryRow[];
  test: DecisionHistoryRow[];
};

export function oddsPayoutYen(row: DecisionHistoryRow, stakeYen: number): number {
  if (row.result !== row.selection || row.currentOdds == null || stakeYen <= 0) return 0;
  return row.currentOdds * stakeYen;
}

export function summarizeMonth(rows: DecisionHistoryRow[], ym: string, minSampleSize = 0): MonthlySummary {
  const monthRows = rows.filter((row) => row.date.startsWith(ym) && row.sampleSize >= minSampleSize);
  const buyRows = monthRows.filter((row) => row.decision === "BUY");
  const modelStakeYen = buyRows.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
  const modelPayoutYen = buyRows
    .reduce((sum, row) => sum + oddsPayoutYen(row, row.recommendedStakeYen), 0);

  const dayMap = new Map<string, { total: number; buy: number }>();
  for (const row of monthRows) {
    const day = dayMap.get(row.date) ?? { total: 0, buy: 0 };
    day.total += 1;
    if (row.decision === "BUY") day.buy += 1;
    dayMap.set(row.date, day);
  }
  const daysActive = dayMap.size;
  const noBuyDays = [...dayMap.values()].filter((day) => day.buy === 0).length;

  return {
    ym,
    decisions: monthRows.length,
    buy: buyRows.length,
    bought: monthRows.filter((row) => row.actuallyBought).length,
    hits: buyRows.filter((row) => row.result === row.selection).length,
    hitRate: buyRows.length ? buyRows.filter((row) => row.result === row.selection).length / buyRows.length : 0,
    modelStakeYen,
    modelPayoutYen,
    modelRoi: modelStakeYen ? modelPayoutYen / modelStakeYen : 0,
    daysActive,
    noBuyDays,
  };
}

export function summarizeByMonth(rows: DecisionHistoryRow[], minSampleSize = 0): MonthlySummary[] {
  const months = [...new Set(rows.map((row) => row.date.slice(0, 7)).filter(Boolean))].sort();
  return months.map((ym) => summarizeMonth(rows, ym, minSampleSize));
}

export function splitTrainTestByDate(
  rows: DecisionHistoryRow[],
  boundaryDate: string,
  mode: "exclusive" | "inclusive" = "exclusive",
): PeriodSplit {
  return {
    train: rows.filter((row) => mode === "inclusive" ? row.date <= boundaryDate : row.date < boundaryDate),
    test: rows.filter((row) => mode === "inclusive" ? row.date > boundaryDate : row.date >= boundaryDate),
  };
}

export function splitTrainTestByRatio(rows: DecisionHistoryRow[], trainRatio = 0.7): PeriodSplit {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const safeRatio = Math.min(1, Math.max(0, trainRatio));
  const index = Math.floor(sorted.length * safeRatio);
  return {
    train: sorted.slice(0, index),
    test: sorted.slice(index),
  };
}

export function summarizeHistory(rows: DecisionHistoryRow[], minSampleSize = 0): BacktestSummary {
  const validRows = rows.filter((row) => row.sampleSize >= minSampleSize);
  const excludedCount = rows.length - validRows.length;
  const validBuyRows = validRows.filter((row) => row.decision === "BUY");
  const validModelStakeYen = validBuyRows.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
  const validModelPayoutYen = validBuyRows
    .reduce((sum, row) => sum + oddsPayoutYen(row, row.recommendedStakeYen), 0);
  const validHits = validRows.filter((row) => row.result === row.selection).length;
  const totalStakeYen = rows.reduce((sum, row) => sum + row.stakeYen, 0);
  const totalPayoutYen = rows
    .filter((row) => row.actuallyBought)
    .reduce((sum, row) => sum + oddsPayoutYen(row, row.stakeYen), 0);
  const modelRows = rows.filter((row) => row.decision === "BUY");
  const modelStakeYen = modelRows.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
  const modelPayoutYen = modelRows
    .reduce((sum, row) => sum + oddsPayoutYen(row, row.recommendedStakeYen), 0);
  const hits = rows.filter((row) => row.result === row.selection).length;

  const decisions = rows.length;
  const emptySummary: BacktestSummary = {
    decisions,
    buy: rows.filter((row) => row.decision === "BUY").length,
    watch: rows.filter((row) => row.decision === "WATCH").length,
    skip: rows.filter((row) => row.decision === "SKIP").length,
    bought: rows.filter((row) => row.actuallyBought).length,
    totalStakeYen,
    totalPayoutYen,
    modelStakeYen,
    modelPayoutYen,
    modelRoi: modelStakeYen ? modelPayoutYen / modelStakeYen : 0,
    hits,
    hitRate: rows.length ? hits / rows.length : 0,
    roi: totalStakeYen ? totalPayoutYen / totalStakeYen : 0,
    excludedSampleShort: excludedCount,
    validDecisions: validRows.length,
    validBuy: validBuyRows.length,
    validHits,
    validHitRate: validRows.length ? validHits / validRows.length : 0,
    validModelStakeYen,
    validModelPayoutYen,
    validModelRoi: validModelStakeYen ? validModelPayoutYen / validModelStakeYen : 0,
    byDecision: [],
    overvaluation: [],
    byVenue: [],
  };

  const byDecision = new Map<DecisionStatus, DecisionHistoryRow[]>();
  const byVenue = new Map<string, DecisionHistoryRow[]>();
  for (const row of rows) {
    byDecision.set(row.decision, [...(byDecision.get(row.decision) ?? []), row]);
    byVenue.set(row.venue, [...(byVenue.get(row.venue) ?? []), row]);
  }

  emptySummary.byDecision = [...byDecision.entries()].map(([decision, grouped]) => {
    const stakeYen = grouped.reduce((sum, row) => sum + row.stakeYen, 0);
    const payoutYen = grouped
      .filter((row) => row.actuallyBought)
      .reduce((sum, row) => sum + oddsPayoutYen(row, row.stakeYen), 0);
    const modelStakeYen = grouped.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
    const modelPayoutYen = grouped
      .filter((row) => row.decision === "BUY")
      .reduce((sum, row) => sum + oddsPayoutYen(row, row.recommendedStakeYen), 0);
    return {
      decision,
      count: grouped.length,
      stakeYen,
      payoutYen,
      roi: stakeYen ? payoutYen / stakeYen : 0,
      modelStakeYen,
      modelPayoutYen,
      modelRoi: modelStakeYen ? modelPayoutYen / modelStakeYen : 0,
    };
  });

  emptySummary.byVenue = [...byVenue.entries()].map(([venue, grouped]) => {
    const stakeYen = grouped.reduce((sum, row) => sum + row.stakeYen, 0);
    const payoutYen = grouped
      .filter((row) => row.actuallyBought)
      .reduce((sum, row) => sum + oddsPayoutYen(row, row.stakeYen), 0);
    const modelStakeYen = grouped.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
    const modelPayoutYen = grouped
      .filter((row) => row.decision === "BUY")
      .reduce((sum, row) => sum + oddsPayoutYen(row, row.recommendedStakeYen), 0);
    return {
      venue,
      count: grouped.length,
      buy: grouped.filter((row) => row.decision === "BUY").length,
      stakeYen,
      payoutYen,
      roi: stakeYen ? payoutYen / stakeYen : 0,
      modelStakeYen,
      modelPayoutYen,
      modelRoi: modelStakeYen ? modelPayoutYen / modelStakeYen : 0,
    };
  }).sort((a, b) => b.count - a.count);

  return emptySummary;
}
