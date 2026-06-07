import type { LabEvaluation, LabRow, LabRule, Metric, TicketResult } from "./types.js";

export const STAKE_YEN = 100;

export function ticketResult(row: LabRow, tickets: string[], raceOdds: Map<string, number>): TicketResult {
  const valid = tickets
    .map((selection) => ({ selection, odds: selection === row.selection ? row.odds : raceOdds.get(selection) ?? null }))
    .filter((ticket): ticket is { selection: string; odds: number } => ticket.odds != null);
  const hit = valid.find((ticket) => ticket.selection === row.result);
  return {
    stake: valid.length * STAKE_YEN,
    ret: hit ? hit.odds * STAKE_YEN : 0,
    hit: Boolean(hit),
    hitOdds: hit?.odds ?? 0,
  };
}

export function metric(results: TicketResult[]): Metric {
  const stake = results.reduce((sum, result) => sum + result.stake, 0);
  const ret = results.reduce((sum, result) => sum + result.ret, 0);
  const hits = results.filter((result) => result.hit);
  const maxHitOdds = Math.max(0, ...hits.map((result) => result.hitOdds));
  return {
    n: results.length,
    hits: hits.length,
    hitRate: results.length ? hits.length / results.length : 0,
    stake,
    ret,
    roi: stake ? ret / stake : 0,
    maxHitOdds,
    roiExMaxHit: stake ? Math.max(0, ret - maxHitOdds * STAKE_YEN) / stake : 0,
  };
}

export function evaluateRule(rows: LabRow[], odds: Map<string, Map<string, number>>, rule: LabRule, baseline: Metric): LabEvaluation {
  const afterResults = rows.flatMap((row) => {
    const raceOdds = odds.get(row.raceId) ?? new Map<string, number>();
    if (!rule.predicate(row)) return [ticketResult(row, [row.selection], raceOdds)];
    if (rule.action === "NO_BUY" || rule.action === "PAPER_ONLY") return [];
    return [ticketResult(row, rule.tickets(row, raceOdds), raceOdds)];
  });
  const removedRows = rows.filter(rule.predicate);
  const removedResults = removedRows.map((row) => ticketResult(row, [row.selection], odds.get(row.raceId) ?? new Map<string, number>()));
  const after = metric(afterResults);
  const removed = metric(removedResults);
  const split = splitMetrics(rows, odds, rule);
  const warnings: string[] = [];
  if (removedRows.length < 50) warnings.push("n不足");
  if (after.n < 300) warnings.push("残りn不足");
  if (rule.action !== "NO_BUY" && after.stake > baseline.stake * 1.8) warnings.push("投資額増えすぎ");
  if (after.roiExMaxHit <= baseline.roiExMaxHit) warnings.push("最大1hit除外で改善なし");
  if (split.test.roi < baseline.roi - 0.08) warnings.push("test弱い");
  const improvement = after.roi - baseline.roi;
  let judgement: LabEvaluation["judgement"] = "D";
  if (removedRows.length < 50) judgement = "C";
  else if (improvement <= 0) judgement = "D";
  else if (after.n >= 1000 && improvement >= 0.03 && warnings.length <= 1) judgement = "S";
  else if (after.n >= 300 && improvement >= 0.015) judgement = "A";
  else judgement = "B";
  return { label: rule.label, family: rule.family, action: rule.action, baseline, after, removed, improvement, ...split, warnings, judgement };
}

function splitMetrics(rows: LabRow[], odds: Map<string, Map<string, number>>, rule: LabRule) {
  const trainEnd = Math.floor(rows.length * 0.7);
  const validationEnd = Math.floor(rows.length * 0.9);
  return {
    train: evaluateSlice(rows.slice(0, trainEnd), odds, rule),
    validation: evaluateSlice(rows.slice(trainEnd, validationEnd), odds, rule),
    test: evaluateSlice(rows.slice(validationEnd), odds, rule),
  };
}

function evaluateSlice(rows: LabRow[], odds: Map<string, Map<string, number>>, rule: LabRule) {
  return metric(rows.flatMap((row) => {
    const raceOdds = odds.get(row.raceId) ?? new Map<string, number>();
    if (!rule.predicate(row)) return [ticketResult(row, [row.selection], raceOdds)];
    if (rule.action === "NO_BUY" || rule.action === "PAPER_ONLY") return [];
    return [ticketResult(row, rule.tickets(row, raceOdds), raceOdds)];
  }));
}

export function compareEvaluation(a: LabEvaluation, b: LabEvaluation): number {
  const rank = { S: 5, A: 4, B: 3, C: 1, D: 0 } as const;
  return rank[b.judgement] - rank[a.judgement] || b.improvement - a.improvement || b.after.n - a.after.n;
}
