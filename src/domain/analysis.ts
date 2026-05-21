import type { DecisionHistoryRow } from "./backtest";

export type OvervaluationRow = {
  venue: string;
  selection: string;
  count: number;
  avgEv: number;
  misses: number;
  hitRate: number;
  note: string;
};

export function analyzeOvervaluation(rows: DecisionHistoryRow[]): OvervaluationRow[] {
  const candidates = rows.filter((row) => row.decision === "BUY" && row.ev != null);
  const grouped = new Map<string, DecisionHistoryRow[]>();
  for (const row of candidates) {
    const key = `${row.venue}|${row.selection}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return [...grouped.entries()].map(([key, group]) => {
    const [venue, selection] = key.split("|");
    const hits = group.filter((row) => row.result === row.selection).length;
    const avgEv = group.reduce((sum, row) => sum + (row.ev ?? 0), 0) / group.length;
    const hitRate = hits / group.length;
    const misses = group.length - hits;
    return {
      venue,
      selection,
      count: group.length,
      avgEv,
      misses,
      hitRate,
      note: misses > hits ? "過大評価候補" : "継続監視",
    };
  }).sort((a, b) => b.misses - a.misses || b.avgEv - a.avgEv);
}
