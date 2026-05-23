import { MODEL_VERSION } from "./modelVersion";
import { featureAdjustmentForSelection, type ProgramFeatureSnapshot } from "./programFeatures";
import type { BetCandidate, RaceResult } from "./types";

export type ModelCandidateInput = {
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
  raceCategory?: string;
  features?: ProgramFeatureSnapshot;
};

export type CourseRate = {
  course: number;
  first: number;
  second: number;
  third: number;
  starts: number;
};

export type SecondThirdDistribution = {
  firstCourse: number;
  secondCourse: number;
  thirdCourse: number;
  count: number;
  probability: number;
};

export type CandidateModelSummary = {
  venue: string;
  selection: string;
  hitCount: number;
  venueRaceCount: number;
  estimatedHitRate: number;
  courseRates: CourseRate[];
  secondThirdDistribution: SecondThirdDistribution[];
};

const COURSES = [1, 2, 3, 4, 5, 6] as const;
const TRIFECTA_SPACE = 6 * 5 * 4;

export function buildVenueModel(results: RaceResult[], minVenueRaceCount = 1, alpha = 1): CandidateModelSummary[] {
  const byVenue = new Map<string, RaceResult[]>();

  for (const result of results) {
    if (!result.trifecta || result.returned) continue;
    const selection = parseSelection(result.trifecta);
    if (!selection) continue;
    byVenue.set(result.venue, [...(byVenue.get(result.venue) ?? []), result]);
  }

  return [...byVenue.entries()].flatMap(([venue, venueResults]) => {
    const venueRaceCount = venueResults.length;
    if (venueRaceCount < minVenueRaceCount) return [];

    const selectionHits = new Map<string, number>();
    const courseFinishCounts = new Map<number, { first: number; second: number; third: number; starts: number }>();
    const secondThirdCounts = new Map<string, number>();
    const firstCounts = new Map<number, number>();

    for (const course of COURSES) {
      courseFinishCounts.set(course, { first: 0, second: 0, third: 0, starts: venueRaceCount });
    }

    for (const result of venueResults) {
      const selection = parseSelection(result.trifecta);
      if (!selection) continue;
      const [first, second, third] = selection;
      const key = selection.join("-");
      selectionHits.set(key, (selectionHits.get(key) ?? 0) + 1);
      firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1);
      secondThirdCounts.set(`${first}-${second}-${third}`, (secondThirdCounts.get(`${first}-${second}-${third}`) ?? 0) + 1);
      courseFinishCounts.get(first)!.first += 1;
      courseFinishCounts.get(second)!.second += 1;
      courseFinishCounts.get(third)!.third += 1;
    }

    const courseRates = COURSES.map((course) => {
      const counts = courseFinishCounts.get(course)!;
      return {
        course,
        first: smoothedRate(counts.first, venueRaceCount, alpha, COURSES.length),
        second: smoothedRate(counts.second, venueRaceCount, alpha, COURSES.length),
        third: smoothedRate(counts.third, venueRaceCount, alpha, COURSES.length),
        starts: counts.starts,
      };
    });

    const secondThirdDistribution = [...secondThirdCounts.entries()].map(([key, count]) => {
      const [firstCourse, secondCourse, thirdCourse] = key.split("-").map(Number);
      const firstTotal = firstCounts.get(firstCourse) ?? 0;
      return {
        firstCourse,
        secondCourse,
        thirdCourse,
        count,
        probability: smoothedRate(count, firstTotal, alpha, 5 * 4),
      };
    }).sort((a, b) => b.probability - a.probability || b.count - a.count);

    return [...selectionHits.entries()].map(([selection, hitCount]) => ({
      venue,
      selection,
      hitCount,
      venueRaceCount,
      estimatedHitRate: smoothedRate(hitCount, venueRaceCount, alpha, TRIFECTA_SPACE),
      courseRates,
      secondThirdDistribution,
    }));
  }).sort((a, b) => b.estimatedHitRate - a.estimatedHitRate || b.hitCount - a.hitCount);
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
    const featureAdjustment = featureAdjustmentForSelection(input.features, selection);
    const adjustedHitRate = clamp(best.estimatedHitRate * featureAdjustment, 0.0001, 0.8);
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
      estimatedHitRate: adjustedHitRate,
      sampleSize,
      currentOdds: manualOdds.get(raceId) ?? null,
      targetEv,
      suggestedAmount: 100,
      source: "history-model",
      fetchedAt,
      hasRiskFlag,
      modelVersion: MODEL_VERSION,
      raceCategory: input.raceCategory ?? "不明",
      featureAdjustment,
    }];
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothedRate(count: number, total: number, alpha: number, buckets: number) {
  if (total <= 0) return 0;
  return (count + alpha) / (total + alpha * buckets);
}

function parseSelection(value: string | null): [number, number, number] | null {
  const nums = String(value ?? "").match(/[1-6]/g)?.map(Number) ?? [];
  if (nums.length !== 3) return null;
  if (new Set(nums).size !== 3) return null;
  return nums as [number, number, number];
}
