import { judgeCandidate } from "../src/domain/decision";
import { officialOddsUrl } from "../src/domain/officialLinks";
import { buildCandidatesFromModel, buildVenueModel } from "../src/domain/model";
import { sampleCandidates } from "../src/sampleData";
import type { BetCandidate, BudgetRule, RaceResult } from "../src/domain/types";

type ProgramInput = {
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
};

export function buildCandidateRows(
  settings: BudgetRule,
  now = new Date(),
  manualOdds = new Map<string, number>(),
  programInputs: ProgramInput[] = [],
  modelResults: RaceResult[] = [],
) {
  let reservedBudgetYen = 0;
  let buyCountToday = 0;
  const model = buildVenueModel(modelResults, 1);
  const modelCandidates = buildCandidatesFromModel(
    programInputs,
    model,
    settings.targetEv,
    now.toISOString(),
    manualOdds,
  );
  const baseCandidates = modelCandidates.length > 0 ? modelCandidates : sampleCandidates;

  return baseCandidates.map((candidate) => {
    const normalized: BetCandidate = {
      ...candidate,
      targetEv: settings.targetEv,
      currentOdds: manualOdds.get(candidate.raceId) ?? candidate.currentOdds,
      suggestedAmount: settings.stakePerBetYen,
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
