import type { DecisionStatus } from "./types";

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
  hits: number;
  hitRate: number;
  roi: number;
  byDecision: Array<{
    decision: DecisionStatus;
    count: number;
    stakeYen: number;
    payoutYen: number;
    roi: number;
  }>;
  byVenue: Array<{
    venue: string;
    count: number;
    buy: number;
    stakeYen: number;
    payoutYen: number;
    roi: number;
  }>;
};

export function summarizeHistory(rows: DecisionHistoryRow[]): BacktestSummary {
  const totalStakeYen = rows.reduce((sum, row) => sum + row.stakeYen, 0);
  const totalPayoutYen = rows.reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
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
    hits,
    hitRate: rows.length ? hits / rows.length : 0,
    roi: totalStakeYen ? totalPayoutYen / totalStakeYen : 0,
    byDecision: [],
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
    const payoutYen = grouped.reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
    return {
      decision,
      count: grouped.length,
      stakeYen,
      payoutYen,
      roi: stakeYen ? payoutYen / stakeYen : 0,
    };
  });

  emptySummary.byVenue = [...byVenue.entries()].map(([venue, grouped]) => {
    const stakeYen = grouped.reduce((sum, row) => sum + row.stakeYen, 0);
    const payoutYen = grouped.reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
    return {
      venue,
      count: grouped.length,
      buy: grouped.filter((row) => row.decision === "BUY").length,
      stakeYen,
      payoutYen,
      roi: stakeYen ? payoutYen / stakeYen : 0,
    };
  }).sort((a, b) => b.count - a.count);

  return emptySummary;
}
