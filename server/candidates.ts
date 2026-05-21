import { judgeCandidate } from "../src/domain/decision";
import { officialOddsUrl } from "../src/domain/officialLinks";
import { sampleCandidates } from "../src/sampleData";
import type { BetCandidate, BudgetRule } from "../src/domain/types";

export function buildCandidateRows(settings: BudgetRule, now = new Date(), manualOdds = new Map<string, number>()) {
  let reservedBudgetYen = 0;
  let buyCountToday = 0;

  return sampleCandidates.map((candidate) => {
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
