import { judgeCandidate } from "../src/domain/decision";
import { officialOddsUrl } from "../src/domain/officialLinks";
import { buildCandidatesFromModel, buildVenueModel } from "../src/domain/model";
import { filterComparableResultsForDate } from "../src/domain/raceRegime";
import { sampleCandidates } from "../src/sampleData";
import type { ProgramFeatureSnapshot } from "../src/domain/programFeatures";
import type { BetCandidate, BudgetRule, RaceResult } from "../src/domain/types";

type ProgramInput = {
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
  raceCategory?: string;
  features?: ProgramFeatureSnapshot;
};

export function buildCandidateRows(
  settings: BudgetRule,
  now = new Date(),
  manualOdds = new Map<string, number>(),
  programInputs: ProgramInput[] = [],
  modelResults: RaceResult[] = [],
  earlyOdds = new Map<string, number>(),
) {
  let reservedBudgetYen = 0;
  let buyCountToday = 0;
  const targetDate = programInputs[0]?.date ?? now.toISOString().slice(0, 10);
  const comparableResults = filterComparableResultsForDate(modelResults, targetDate);
  const model = buildVenueModel(comparableResults, 1);
  const modelCandidates = buildCandidatesFromModel(
    programInputs,
    model,
    settings.targetEv,
    now.toISOString(),
    manualOdds,
  );
  const baseCandidates = modelCandidates.length > 0 ? modelCandidates : sampleCandidates;

  return baseCandidates.map((candidate) => {
    const currentOdds = manualOdds.get(candidate.raceId) ?? candidate.currentOdds;
    const earlyOddsKey = `${candidate.raceId}/${candidate.selection.join("-")}`;
    const earlyOddsValue = earlyOdds.get(earlyOddsKey) ?? null;
    const sharpSignalDrop = earlyOddsValue != null && currentOdds != null && earlyOddsValue > 0
      ? (earlyOddsValue - currentOdds) / earlyOddsValue
      : null;

    const normalized: BetCandidate = {
      ...candidate,
      targetEv: settings.targetEv,
      currentOdds,
      suggestedAmount: settings.stakePerBetYen,
      sharpSignalDrop,
    };
    const decision = judgeCandidate(normalized, settings, {
      now,
      buyCountToday,
      reservedBudgetYen,
    });
    if (decision.status === "BUY") {
      buyCountToday += 1;
      reservedBudgetYen += decision.recommendedAmount;
    }
    return {
      candidate: normalized,
      decision,
      officialUrl: officialOddsUrl(normalized.date, normalized.venue, normalized.raceNo),
    };
  });
}
