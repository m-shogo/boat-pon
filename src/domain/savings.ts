import type { DecisionHistoryRow } from "./backtest";

export type SavingsSummary = {
  buySignals: number;
  unboughtBuySignals: number;
  simulatedStakeYen: number;
  simulatedPayoutYen: number;
  simulatedNetYen: number;
  savedLossYen: number;
  missedProfitYen: number;
  actualStakeYen: number;
  protectedStakeYen: number;
  consecutiveNoBuyDays: number;
};

export function calculateSavings(rows: DecisionHistoryRow[], today?: string): SavingsSummary {
  const buyRows = rows.filter((row) => row.decision === "BUY");
  const simulatedStakeYen = buyRows.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
  const simulatedPayoutYen = buyRows
    .filter((row) => row.result === row.selection)
    .reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
  const simulatedNetYen = simulatedPayoutYen - simulatedStakeYen;
  const actualStakeYen = rows.reduce((sum, row) => sum + row.stakeYen, 0);
  const unboughtBuySignals = buyRows.filter((row) => !row.actuallyBought).length;
  const protectedStakeYen = buyRows
    .filter((row) => !row.actuallyBought)
    .reduce((sum, row) => sum + row.recommendedStakeYen, 0);

  return {
    buySignals: buyRows.length,
    unboughtBuySignals,
    simulatedStakeYen,
    simulatedPayoutYen,
    simulatedNetYen,
    savedLossYen: simulatedNetYen < 0 ? Math.abs(simulatedNetYen) : 0,
    missedProfitYen: simulatedNetYen > 0 ? simulatedNetYen : 0,
    actualStakeYen,
    protectedStakeYen,
    consecutiveNoBuyDays: countConsecutiveNoBuyDays(rows, today),
  };
}

export function countConsecutiveNoBuyDays(rows: DecisionHistoryRow[], today?: string): number {
  const byDate = new Map<string, DecisionHistoryRow[]>();
  for (const row of rows) {
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  const startDate = today ?? dates[0];
  if (!startDate) return 0;

  let count = 0;
  for (const date of dates.filter((date) => date <= startDate)) {
    const dayRows = byDate.get(date) ?? [];
    if (dayRows.some((row) => row.actuallyBought && row.stakeYen > 0)) break;
    count += 1;
  }
  return count;
}
