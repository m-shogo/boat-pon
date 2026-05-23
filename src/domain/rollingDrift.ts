import { summarizeMonth, type DecisionHistoryRow } from "./backtest";

export type RollingDriftRow = {
  ym: string;
  buy: number;
  modelRoi: number;
  hitRate: number;
  avgEstimatedHitRate: number;
  calibration: number;
  alert: "ok" | "watch" | "drift";
};

export type RollingDriftSummary = {
  rows: RollingDriftRow[];
  latest: RollingDriftRow | null;
};

export function summarizeRollingDrift(history: DecisionHistoryRow[], minSampleSize = 0): RollingDriftSummary {
  const months = [...new Set(history.map((row) => row.date.slice(0, 7)).filter(Boolean))].sort();
  const rows = months.map((ym) => {
    const monthRows = history.filter((row) => row.date.startsWith(ym) && row.sampleSize >= minSampleSize);
    const buyRows = monthRows.filter((row) => row.decision === "BUY");
    const monthly = summarizeMonth(history, ym, minSampleSize);
    const avgEstimatedHitRate = buyRows.length
      ? buyRows.reduce((sum, row) => sum + row.estimatedHitRate, 0) / buyRows.length
      : 0;
    const calibration = avgEstimatedHitRate ? monthly.hitRate / avgEstimatedHitRate : 0;
    const alert = buyRows.length < 5 ? "watch" : calibration < 0.65 || monthly.modelRoi < 0.6 ? "drift" : calibration < 0.85 ? "watch" : "ok";
    return {
      ym,
      buy: monthly.buy,
      modelRoi: monthly.modelRoi,
      hitRate: monthly.hitRate,
      avgEstimatedHitRate,
      calibration,
      alert,
    } satisfies RollingDriftRow;
  });
  return { rows, latest: rows.at(-1) ?? null };
}
