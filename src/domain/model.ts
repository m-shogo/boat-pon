import type { BetCandidate, RaceResult } from "./types";

export type ModelCandidateInput = {
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
};

export type CandidateModelSummary = {
  venue: string;
  selection: string;
  hitCount: number;
  venueRaceCount: number;
  estimatedHitRate: number;
};

export function buildVenueModel(results: RaceResult[], minVenueRaceCount = 1): CandidateModelSummary[] {
  const venueTotals = new Map<string, number>();
  const selectionHits = new Map<string, number>();

  for (const result of results) {
    if (!result.trifecta || result.returned) continue;
    venueTotals.set(result.venue, (venueTotals.get(result.venue) ?? 0) + 1);
    const key = `${result.venue}|${result.trifecta}`;
    selectionHits.set(key, (selectionHits.get(key) ?? 0) + 1);
  }

  return [...selectionHits.entries()].flatMap(([key, hitCount]) => {
    const [venue, selection] = key.split("|");
    const venueRaceCount = venueTotals.get(venue) ?? 0;
    if (venueRaceCount < minVenueRaceCount) return [];
    return [{
      venue,
      selection,
      hitCount,
      venueRaceCount,
      estimatedHitRate: hitCount / venueRaceCount,
    }];
  }).sort((a, b) => b.estimatedHitRate - a.estimatedHitRate);
}

export function buildCandidatesFromModel(
  inputs: ModelCandidateInput[],
  model: CandidateModelSummary[],
  targetEv: number,
  fetchedAt: string,
  manualOdds = new Map<string, number>(),
): BetCandidate[] {
  return inputs.flatMap((input) => {
    const best = model.find((row) => row.venue === input.venue);
    if (!best) return [];
    const selection = best.selection.split("-").map(Number);
    const raceId = `${input.date.replaceAll("-", "")}-${input.venue}-${String(input.raceNo).padStart(2, "0")}`;
    const sampleSize = best.venueRaceCount;
    const hasRiskFlag = sampleSize < 10;
    return [{
      raceId,
      date: input.date,
      venue: input.venue,
      raceNo: input.raceNo,
      closeAt: input.closeAt,
      betType: "3連単" as const,
      selection,
      estimatedHitRate: best.estimatedHitRate,
      sampleSize,
      currentOdds: manualOdds.get(raceId) ?? null,
      targetEv,
      suggestedAmount: 100,
      source: "history-model",
      fetchedAt,
      hasRiskFlag,
    }];
  });
}
