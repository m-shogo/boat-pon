import { judgeCandidate } from "../src/domain/decision";
import { officialOddsUrl } from "../src/domain/officialLinks";
import { buildCandidatesFromModel, buildVenueModel } from "../src/domain/model";
import { filterComparableResultsForDate } from "../src/domain/raceRegime";
import { assessEnvironmentRisk } from "../src/domain/raceEnvironment";
import { resolveCandidateOdds } from "../src/domain/oddsSnapshot";
import { sampleCandidates } from "../src/sampleData";
import type { ProgramFeatureSnapshot } from "../src/domain/programFeatures";
import type { RaceEnvironment } from "../src/domain/raceEnvironment";
import type { BetCandidate, BudgetRule, RaceResult } from "../src/domain/types";

type ProgramInput = {
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
  raceCategory?: string;
  beforeInfoComplete?: boolean;
  features?: ProgramFeatureSnapshot;
};

// 同一ジョブ内で同じ結果配列からモデルを再構築しない。
// auto-fetchは取得前後で候補オッズだけを更新するため、学習結果は再利用できる。
const venueModelCache = new WeakMap<RaceResult[], Map<string, ReturnType<typeof buildVenueModel>>>();

export function buildCandidateRows(
  settings: BudgetRule,
  now = new Date(),
  manualOdds = new Map<string, number>(),
  programInputs: ProgramInput[] = [],
  modelResults: RaceResult[] = [],
  earlyOdds = new Map<string, number>(),
  allOdds = new Map<string, number>(),
  weatherMap = new Map<string, RaceEnvironment>(),
) {
  let reservedBudgetYen = 0;
  let buyCountToday = 0;
  const targetDate = programInputs[0]?.date ?? now.toISOString().slice(0, 10);
  const model = cachedVenueModel(modelResults, targetDate);
  const modelCandidates = buildCandidatesFromModel(
    programInputs,
    model,
    settings.targetEv,
    now.toISOString(),
    manualOdds,
    allOdds,
  );
  const baseCandidates = modelCandidates.length > 0 ? modelCandidates : sampleCandidates;

  return baseCandidates.map((candidate) => {
    const currentOdds = resolveCandidateOdds(candidate.currentOdds, manualOdds.get(candidate.raceId) ?? null);
    const earlyOddsKey = `${candidate.raceId}/${candidate.selection.join("-")}`;
    const earlyOddsValue = earlyOdds.get(earlyOddsKey) ?? null;
    const sharpSignalDrop = earlyOddsValue != null && currentOdds != null && earlyOddsValue > 0
      ? (earlyOddsValue - currentOdds) / earlyOddsValue
      : null;
    const envRisk = assessEnvironmentRisk(weatherMap.get(candidate.raceId) ?? null);

    const normalized: BetCandidate = {
      ...candidate,
      targetEv: settings.targetEv,
      currentOdds,
      suggestedAmount: settings.stakePerBetYen,
      sharpSignalDrop,
      environmentRiskLevel: envRisk.level,
      environmentRiskReasons: envRisk.reasons,
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

function cachedVenueModel(modelResults: RaceResult[], targetDate: string) {
  let byTargetDate = venueModelCache.get(modelResults);
  if (!byTargetDate) {
    byTargetDate = new Map();
    venueModelCache.set(modelResults, byTargetDate);
  }
  const cached = byTargetDate.get(targetDate);
  if (cached) return cached;
  const comparableResults = filterComparableResultsForDate(modelResults, targetDate);
  const model = buildVenueModel(comparableResults, 1);
  byTargetDate.set(targetDate, model);
  return model;
}
