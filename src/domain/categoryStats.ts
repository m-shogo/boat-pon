import type { DecisionHistoryRow } from "./backtest";
import { summarizeGroup, type RoiRow } from "./segmentStats";

export type CategoryStatSummary = {
  rows: RoiRow[];
};

export function summarizeCategoryStats(history: DecisionHistoryRow[]): CategoryStatSummary {
  const groups = new Map<string, DecisionHistoryRow[]>();
  for (const row of history.filter((r) => r.decision === "BUY")) {
    const key = row.raceCategory ?? "不明";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return {
    rows: [...groups.entries()]
      .map(([key, rows]) => summarizeGroup(key, key, rows))
      .sort((a, b) => b.buy - a.buy || b.modelRoi - a.modelRoi),
  };
}
