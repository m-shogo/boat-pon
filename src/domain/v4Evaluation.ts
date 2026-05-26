import type { DecisionStatus } from "./types";

export type EvaluationDecision = DecisionStatus | "NO_MODEL";

export type V4EvaluationRow = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  selection: string | null;
  className: string | null;
  decision: EvaluationDecision;
  hit: boolean;
  returned: boolean;
  requiredOdds: number | null;
  currentOdds: number | null;
  ev: number | null;
  rawEstimatedHitRate: number | null;
  conservativeHitRate: number | null;
  estimatedHitRate: number | null;
};

export type EvaluationSummary = {
  races: number;
  modeled: number;
  buy: number;
  watch: number;
  skip: number;
  noModel: number;
  hits: number;
  returned: number;
  roi: number | null;
  maxHitOdds: number | null;
  roiExMax: number | null;
  avgRequiredOdds: number | null;
  avgCurrentOdds: number | null;
  avgOddsRatio: number | null;
  avgRawEstimatedHitRate: number | null;
  avgConservativeHitRate: number | null;
  avgConservativeDiscount: number | null;
};

export type EvaluationGroupSummary = EvaluationSummary & {
  key: string;
  label: string;
};

export type EvaluationReport = {
  overall: EvaluationSummary;
  byYear: EvaluationGroupSummary[];
  byMonth: EvaluationGroupSummary[];
  byVenue: EvaluationGroupSummary[];
  byRequiredOddsBand: EvaluationGroupSummary[];
  byOddsRatioBand: EvaluationGroupSummary[];
  byClassName: EvaluationGroupSummary[];
};

export function summarizeEvaluation(rows: V4EvaluationRow[]): EvaluationReport {
  return {
    overall: summarizeRows(rows),
    byYear: summarizeGroups(rows, (row) => row.date.slice(0, 4)),
    byMonth: summarizeGroups(rows, (row) => row.date.slice(0, 7)),
    byVenue: summarizeGroups(rows, (row) => row.venue),
    byRequiredOddsBand: summarizeGroups(rows, (row) => requiredOddsBand(row.requiredOdds)),
    byOddsRatioBand: summarizeGroups(rows, (row) => oddsRatioBand(row)),
    byClassName: summarizeGroups(rows, (row) => row.className ?? "不明"),
  };
}

export function summarizeRows(rows: V4EvaluationRow[]): EvaluationSummary {
  const buyRows = rows.filter((row) => row.decision === "BUY");
  const effectiveBuyRows = buyRows.filter((row) => !row.returned);
  const hitRows = effectiveBuyRows.filter((row) => row.hit);
  const returned = buyRows.length - effectiveBuyRows.length;
  const payoutOdds = hitRows.reduce((sum, row) => sum + (row.currentOdds ?? 0), 0);
  const maxHitOdds = hitRows.reduce<number | null>((max, row) => {
    if (row.currentOdds == null) return max;
    return max == null ? row.currentOdds : Math.max(max, row.currentOdds);
  }, null);
  const roi = effectiveBuyRows.length ? payoutOdds / effectiveBuyRows.length : null;
  const roiExMax = roi != null && maxHitOdds != null && effectiveBuyRows.length > 0
    ? roi - maxHitOdds / effectiveBuyRows.length
    : null;

  return {
    races: rows.length,
    modeled: rows.filter((row) => row.decision !== "NO_MODEL").length,
    buy: buyRows.length,
    watch: rows.filter((row) => row.decision === "WATCH").length,
    skip: rows.filter((row) => row.decision === "SKIP").length,
    noModel: rows.filter((row) => row.decision === "NO_MODEL").length,
    hits: hitRows.length,
    returned,
    roi,
    maxHitOdds,
    roiExMax,
    avgRequiredOdds: average(rows.map((row) => row.requiredOdds)),
    avgCurrentOdds: average(rows.map((row) => row.currentOdds)),
    avgOddsRatio: average(rows.map((row) => oddsRatio(row))),
    avgRawEstimatedHitRate: average(rows.map((row) => row.rawEstimatedHitRate)),
    avgConservativeHitRate: average(rows.map((row) => row.conservativeHitRate)),
    avgConservativeDiscount: average(rows.map((row) => conservativeDiscount(row))),
  };
}

function summarizeGroups(rows: V4EvaluationRow[], keyFor: (row: V4EvaluationRow) => string): EvaluationGroupSummary[] {
  const groups = new Map<string, V4EvaluationRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, groupRows]) => ({ key, label: key, ...summarizeRows(groupRows) }))
    .sort((a, b) => a.key.localeCompare(b.key, "ja"));
}

function requiredOddsBand(requiredOdds: number | null) {
  if (requiredOdds == null || !Number.isFinite(requiredOdds)) return "不明";
  if (requiredOdds < 25) return "<25";
  if (requiredOdds < 30) return "25-30";
  if (requiredOdds < 40) return "30-40";
  if (requiredOdds < 50) return "40-50";
  if (requiredOdds < 70) return "50-70";
  if (requiredOdds < 100) return "70-100";
  return "100+";
}

function oddsRatioBand(row: V4EvaluationRow) {
  const ratio = oddsRatio(row);
  if (ratio == null) return "不明";
  if (ratio < 1.0) return "<1.0";
  if (ratio < 1.2) return "1.0-1.2";
  if (ratio < 1.5) return "1.2-1.5";
  if (ratio < 2.0) return "1.5-2.0";
  return "2.0+";
}

function oddsRatio(row: V4EvaluationRow) {
  if (row.currentOdds == null || row.requiredOdds == null || row.requiredOdds <= 0 || !Number.isFinite(row.requiredOdds)) return null;
  return row.currentOdds / row.requiredOdds;
}

function conservativeDiscount(row: V4EvaluationRow) {
  if (row.rawEstimatedHitRate == null || row.conservativeHitRate == null || row.rawEstimatedHitRate <= 0) return null;
  return Math.max(0, 1 - row.conservativeHitRate / row.rawEstimatedHitRate);
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}
