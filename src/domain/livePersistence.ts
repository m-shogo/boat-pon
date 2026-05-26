import type { BetCandidate, BudgetRule } from "./types";

export const ODDS_FETCH_WINDOW_MINUTES = 30;

export function minutesUntilRaceClose(date: string, closeAt: string, now = new Date()): number {
  const close = new Date(`${date}T${closeAt}:00+09:00`);
  return (close.getTime() - now.getTime()) / 60_000;
}

export function isWithinOddsFetchWindow(
  candidate: Pick<BetCandidate, "date" | "closeAt">,
  rule: Pick<BudgetRule, "minMinutesBeforeClose">,
  now = new Date(),
  fetchWindowMinutes = ODDS_FETCH_WINDOW_MINUTES,
): boolean {
  const minutes = minutesUntilRaceClose(candidate.date, candidate.closeAt, now);
  return minutes >= rule.minMinutesBeforeClose && minutes <= fetchWindowMinutes;
}

export function shouldPersistDecisionHistory(
  candidate: Pick<BetCandidate, "date" | "closeAt" | "currentOdds">,
  rule: Pick<BudgetRule, "minMinutesBeforeClose">,
  liveFrom: string,
  now = new Date(),
): boolean {
  if (candidate.date < liveFrom) return true;
  if (candidate.currentOdds != null) return true;
  return isWithinOddsFetchWindow(candidate, rule, now);
}
