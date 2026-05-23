import { judgeCandidate } from "./decision";
import { buildCandidatesFromModel, buildVenueModel, type ModelCandidateInput } from "./model";
import { filterComparableResultsForDate } from "./raceRegime";
import type { BudgetRule, DecisionStatus, RaceResult } from "./types";

export type WalkForwardInput = {
  results: RaceResult[];
  programs: ModelCandidateInput[];
  settings: BudgetRule;
  oddsByRaceId?: Map<string, number>;
  minTrainRaceCount?: number;
  alpha?: number;
  nowMode?: "race-date" | "before-close";
};

export type WalkForwardRow = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  selection: string | null;
  estimatedHitRate: number | null;
  sampleSize: number;
  requiredOdds: number | null;
  currentOdds: number | null;
  ev: number | null;
  decision: DecisionStatus | "NO_MODEL";
  result: string | null;
  payoutYen: number | null;
  hit: boolean;
  trainResults: number;
};

export type WalkForwardSummary = {
  races: number;
  modeled: number;
  buy: number;
  hits: number;
  modelStakeYen: number;
  modelPayoutYen: number;
  modelRoi: number;
  hitRate: number;
  noModel: number;
};

export function runWalkForwardBacktest(input: WalkForwardInput): WalkForwardRow[] {
  const minTrainRaceCount = input.minTrainRaceCount ?? input.settings.minSampleSize;
  const alpha = input.alpha ?? 1;
  const results = [...input.results]
    .filter((row) => row.trifecta && !row.returned)
    .sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || a.raceNo - b.raceNo);
  const resultByRaceId = new Map(results.map((row) => [row.raceId, row]));

  return [...input.programs]
    .sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || a.raceNo - b.raceNo)
    .map((program) => {
      const raceId = makeRaceId(program);
      const trainResults = filterComparableResultsForDate(
        results.filter((row) => row.date < program.date),
        program.date,
      );
      const model = buildVenueModel(trainResults, minTrainRaceCount, alpha);
      const candidates = buildCandidatesFromModel(
        [program],
        model,
        input.settings.targetEv,
        program.date + "T00:00:00+09:00",
        input.oddsByRaceId ?? new Map(),
      );
      const result = resultByRaceId.get(raceId);
      const candidate = candidates[0];
      if (!candidate) {
        return {
          raceId,
          date: program.date,
          venue: program.venue,
          raceNo: program.raceNo,
          selection: null,
          estimatedHitRate: null,
          sampleSize: 0,
          requiredOdds: null,
          currentOdds: input.oddsByRaceId?.get(raceId) ?? null,
          ev: null,
          decision: "NO_MODEL" as const,
          result: result?.trifecta ?? null,
          payoutYen: result?.payoutYen ?? null,
          hit: false,
          trainResults: trainResults.length,
        };
      }

      const decisionNow = input.nowMode === "before-close"
        ? beforeCloseTime(program.date, program.closeAt, input.settings.minMinutesBeforeClose + 10)
        : new Date(program.date + "T00:00:00+09:00");
      const decision = judgeCandidate(candidate, input.settings, {
        now: decisionNow,
        buyCountToday: 0,
        reservedBudgetYen: 0,
      });
      const selection = candidate.selection.join("-");
      const hit = result?.trifecta === selection;
      return {
        raceId,
        date: program.date,
        venue: program.venue,
        raceNo: program.raceNo,
        selection,
        estimatedHitRate: candidate.estimatedHitRate,
        sampleSize: candidate.sampleSize,
        requiredOdds: decision.requiredOdds,
        currentOdds: candidate.currentOdds,
        ev: decision.ev,
        decision: decision.status,
        result: result?.trifecta ?? null,
        payoutYen: result?.payoutYen ?? null,
        hit,
        trainResults: trainResults.length,
      };
    });
}

export function summarizeWalkForward(rows: WalkForwardRow[], stakePerBetYen: number): WalkForwardSummary {
  const modeledRows = rows.filter((row) => row.decision !== "NO_MODEL");
  const buyRows = rows.filter((row) => row.decision === "BUY");
  const modelStakeYen = buyRows.length * stakePerBetYen;
  const modelPayoutYen = buyRows
    .filter((row) => row.hit)
    .reduce((sum, row) => sum + (row.payoutYen ?? 0), 0);
  const hits = buyRows.filter((row) => row.hit).length;
  return {
    races: rows.length,
    modeled: modeledRows.length,
    buy: buyRows.length,
    hits,
    modelStakeYen,
    modelPayoutYen,
    modelRoi: modelStakeYen ? modelPayoutYen / modelStakeYen : 0,
    hitRate: buyRows.length ? hits / buyRows.length : 0,
    noModel: rows.length - modeledRows.length,
  };
}

function makeRaceId(input: ModelCandidateInput) {
  return input.date.replaceAll("-", "") + "-" + input.venue + "-" + String(input.raceNo).padStart(2, "0");
}

function beforeCloseTime(date: string, closeAt: string, minutesBeforeClose: number) {
  const [hour, minute] = closeAt.split(":").map(Number);
  const base = new Date(`${date}T00:00:00+09:00`);
  base.setHours(hour, minute, 0, 0);
  return new Date(base.getTime() - minutesBeforeClose * 60_000);
}
