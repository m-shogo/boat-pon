import type { BetCandidate } from "./types";

export const LIVE_RUN_KIND_FROM = "2026-01-01";

export type DecisionRunKind = "paper-live" | "historical-backfill" | "manual-test" | "sample";

export function inferDecisionRunKind(candidate: Pick<BetCandidate, "date" | "source">): DecisionRunKind {
  if (candidate.source === "sample") return "sample";
  if (candidate.source === "manual") return "manual-test";
  if (candidate.date >= LIVE_RUN_KIND_FROM) return "paper-live";
  return "historical-backfill";
}

export function isPaperLiveDecision(row: { date: string; modelVersion: string | null; runKind: DecisionRunKind | string | null }, modelVersion: string, liveFrom = LIVE_RUN_KIND_FROM) {
  return row.date >= liveFrom && row.modelVersion === modelVersion && row.runKind === "paper-live";
}

export function assertGenerateHistoryWriteAllowed(args: { to: string; dryRun: boolean; allowLiveWrite: boolean }, liveFrom = LIVE_RUN_KIND_FROM) {
  if (args.to >= liveFrom && !args.allowLiveWrite && !args.dryRun) {
    throw new Error("generate:history live write blocked");
  }
}
