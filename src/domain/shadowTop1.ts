import type { DecisionStatus } from "./types";

export const SHADOW_STAKE_YEN = 100;

export type ShadowTop1Row = {
  raceId: string;
  date: string;
  selection: string;
  decision: DecisionStatus;
  currentOdds: number | null;
  result: string | null;
  payoutYen: number | null;
};

export type ShadowTop1Metric = {
  n: number;
  hits: number;
  hitRate: number;
  stakeYen: number;
  payoutYen: number;
  payoutRoi: number | null;
  currentOddsRoi: number | null;
  payoutRoiExTop1: number | null;
  payoutRoiExTop2: number | null;
  maxDrawdownYen: number;
  maxLossStreak: number;
};

export type ShadowTop1Summary = {
  total: number;
  buy: number;
  watch: number;
  skip: number;
  unsettledBuy: number;
  overall: ShadowTop1Metric;
  byYear: Array<{ year: string; metric: ShadowTop1Metric }>;
};

export function summarizeShadowTop1(rows: ShadowTop1Row[]): ShadowTop1Summary {
  const settledBuyRows = rows.filter((row) =>
    row.decision === "BUY" && row.result != null && row.payoutYen != null,
  );
  const unsettledBuy = rows.filter((row) => row.decision === "BUY").length - settledBuyRows.length;
  const years = [...new Set(settledBuyRows.map((row) => row.date.slice(0, 4)))].sort();
  return {
    total: rows.length,
    buy: rows.filter((row) => row.decision === "BUY").length,
    watch: rows.filter((row) => row.decision === "WATCH").length,
    skip: rows.filter((row) => row.decision === "SKIP").length,
    unsettledBuy,
    overall: metric(settledBuyRows),
    byYear: years.map((year) => ({
      year,
      metric: metric(settledBuyRows.filter((row) => row.date.startsWith(year))),
    })),
  };
}

function metric(rows: ShadowTop1Row[]): ShadowTop1Metric {
  const returns = rows.map((row) => row.result === row.selection ? Math.max(0, row.payoutYen ?? 0) : 0);
  const currentOddsReturns = rows.map((row) =>
    row.result === row.selection && row.currentOdds != null ? row.currentOdds * SHADOW_STAKE_YEN : 0,
  );
  const hits = returns.filter((value) => value > 0).length;
  const stakeYen = rows.length * SHADOW_STAKE_YEN;
  const payoutYen = sum(returns);
  const sortedHitIndices = returns
    .map((value, index) => ({ value, index }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index);
  const exclude = (count: number) => {
    const excluded = new Set(sortedHitIndices.slice(0, count).map((row) => row.index));
    const keptN = rows.length - excluded.size;
    return keptN > 0 ? sum(returns.filter((_, index) => !excluded.has(index))) / (keptN * SHADOW_STAKE_YEN) : null;
  };
  const { maxDrawdownYen, maxLossStreak } = drawdown(returns);
  return {
    n: rows.length,
    hits,
    hitRate: rows.length > 0 ? hits / rows.length : 0,
    stakeYen,
    payoutYen,
    payoutRoi: stakeYen > 0 ? payoutYen / stakeYen : null,
    currentOddsRoi: stakeYen > 0 ? sum(currentOddsReturns) / stakeYen : null,
    payoutRoiExTop1: exclude(1),
    payoutRoiExTop2: exclude(2),
    maxDrawdownYen,
    maxLossStreak,
  };
}

function drawdown(returns: number[]) {
  let balance = 0;
  let peak = 0;
  let maxDrawdownYen = 0;
  let lossStreak = 0;
  let maxLossStreak = 0;
  for (const payout of returns) {
    balance += payout - SHADOW_STAKE_YEN;
    peak = Math.max(peak, balance);
    maxDrawdownYen = Math.max(maxDrawdownYen, peak - balance);
    if (payout === 0) {
      lossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
    } else {
      lossStreak = 0;
    }
  }
  return { maxDrawdownYen, maxLossStreak };
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
