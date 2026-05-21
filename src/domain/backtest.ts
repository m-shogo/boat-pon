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

export function summarizeHistory(rows: DecisionHistoryRow[]): BacktestSummary {
  const totalStakeYen = rows.reduce((sum, row) => sum + row.stakeYen, 0);
  const totalPayoutYen = rows
    .filter((row) => row.actuallyBought && row.result === row.selection)
    .reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
  const modelRows = rows.filter((row) => row.decision === "BUY");
  const modelStakeYen = modelRows.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
  const modelPayoutYen = modelRows
    .filter((row) => row.result === row.selection)
    .reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
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
      .filter((row) => row.actuallyBought && row.result === row.selection)
      .reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
    const modelStakeYen = grouped.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
    const modelPayoutYen = grouped
      .filter((row) => row.decision === "BUY" && row.result === row.selection)
      .reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
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
      .filter((row) => row.actuallyBought && row.result === row.selection)
      .reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
    const modelStakeYen = grouped.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
    const modelPayoutYen = grouped
      .filter((row) => row.decision === "BUY" && row.result === row.selection)
      .reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
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
