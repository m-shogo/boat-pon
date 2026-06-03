import { MODEL_VERSION } from "./modelVersion";
import { featureAdjustmentBreakdownForSelection, type ProgramFeatureSnapshot } from "./programFeatures";
import type { BetCandidate, RaceResult } from "./types";

export type ModelCandidateInput = {
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
  raceCategory?: string;
  beforeInfoComplete?: boolean;
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
  conservativeHitRate: number;
  selectionScore: number;
  courseRates: CourseRate[];
  secondThirdDistribution: SecondThirdDistribution[];
};

const COURSES = [1, 2, 3, 4, 5, 6] as const;
const TRIFECTA_SPACE = 6 * 5 * 4;
export const DEFAULT_MODEL_ALPHA = 15;
const DEFAULT_CONFIDENCE_Z = 1.64;

export function buildVenueModel(results: RaceResult[], minVenueRaceCount = 1, alpha = DEFAULT_MODEL_ALPHA): CandidateModelSummary[] {
  const byVenue = new Map<string, RaceResult[]>();

  for (const result of results) {
    if (!result.trifecta || result.returned) continue;
    const selection = parseSelection(result.trifecta);
    if (!selection) continue;
    const venueResults = byVenue.get(result.venue);
    if (venueResults) {
      venueResults.push(result);
    } else {
      byVenue.set(result.venue, [result]);
    }
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

    return [...selectionHits.entries()].map(([selection, hitCount]) => {
      const estimatedHitRate = smoothedRate(hitCount, venueRaceCount, alpha, TRIFECTA_SPACE);
      const conservativeHitRate = conservativeRate(estimatedHitRate, venueRaceCount + alpha * TRIFECTA_SPACE);
      return {
        venue,
        selection,
        hitCount,
        venueRaceCount,
        estimatedHitRate,
        conservativeHitRate,
        selectionScore: conservativeHitRate,
        courseRates,
        secondThirdDistribution,
      };
    });
  }).sort((a, b) => b.selectionScore - a.selectionScore || b.hitCount - a.hitCount || b.estimatedHitRate - a.estimatedHitRate);
}

export function buildCandidatesFromModel(
  inputs: ModelCandidateInput[],
  model: CandidateModelSummary[],
  targetEv: number,
  fetchedAt: string,
  manualOdds = new Map<string, number>(),
  allOdds = new Map<string, number>(),
): BetCandidate[] {
  const modelByVenue = new Map<string, CandidateModelSummary[]>();
  for (const row of model) {
    const venueRows = modelByVenue.get(row.venue);
    if (venueRows) {
      venueRows.push(row);
    } else {
      modelByVenue.set(row.venue, [row]);
    }
  }

  // allOdds にオッズが存在するレースIDの集合を事前構築（O(n)）
  const raceIdsWithOdds = allOdds.size > 0
    ? new Set([...allOdds.keys()].map((k) => k.slice(0, k.indexOf("/"))))
    : new Set<string>();

  return inputs.flatMap((input) => {
    const venueRows = modelByVenue.get(input.venue) ?? [];
    if (venueRows.length === 0) return [];
    const raceId = `${input.date.replaceAll("-", "")}-${input.venue}-${String(input.raceNo).padStart(2, "0")}`;

    // このレースの全出目オッズが既に取得済みかどうか
    const raceHasOddsInAllOdds = raceIdsWithOdds.has(raceId);

    const candidates: BetCandidate[] = [];
    for (const modelRow of venueRows) {
      const selection = modelRow.selection.split("-").map(Number);
      const selectionStr = modelRow.selection;

      // allOdds にある場合はそちらを優先、なければ top-1 出目に限り manualOdds を使う
      let currentOdds: number | null = null;
      const allOddsKey = `${raceId}/${selectionStr}`;
      if (allOdds.has(allOddsKey)) {
        currentOdds = allOdds.get(allOddsKey) ?? null;
      } else if (allOdds.size === 0 || !raceHasOddsInAllOdds) {
        // allOdds が空 or このレースのオッズが未取得の場合、top-1 出目のみ manualOdds で生成
        // （当日まだオッズ取得前の段階でも候補リストに載せてフェッチ対象にする）
        if (venueRows[0] === modelRow) {
          currentOdds = manualOdds.get(raceId) ?? null;
        } else {
          // top-1 以外の出目はスキップ
          continue;
        }
      } else {
        // allOdds にこのレースのデータがあるが当該出目がない → スキップ
        continue;
      }

      const firstBoatFeature = input.features?.boats.find((boat) => boat.course === selection[0]);
      const secondBoatFeature = input.features?.boats.find((boat) => boat.course === selection[1]);
      const thirdBoatFeature = input.features?.boats.find((boat) => boat.course === selection[2]);
      const featureAdjustmentBreakdown = featureAdjustmentBreakdownForSelection(input.features, selection);
      const featureAdjustment = featureAdjustmentBreakdown.total;
      const adjustedHitRate = clamp(modelRow.conservativeHitRate * featureAdjustment, 0.0001, 0.8);
      const sampleSize = modelRow.venueRaceCount;
      const hasRiskFlag = sampleSize < 10;

      candidates.push({
        raceId,
        date: input.date,
        venue: input.venue,
        raceNo: input.raceNo,
        closeAt: input.closeAt,
        betType: "3連単" as const,
        selection,
        estimatedHitRate: adjustedHitRate,
        rawEstimatedHitRate: modelRow.estimatedHitRate,
        conservativeHitRate: modelRow.conservativeHitRate,
        modelSelectionScore: modelRow.selectionScore,
        sampleSize,
        currentOdds,
        targetEv,
        suggestedAmount: 100,
        source: "history-model",
        fetchedAt,
        hasRiskFlag,
        modelVersion: MODEL_VERSION,
        raceCategory: input.raceCategory ?? "不明",
        beforeInfoComplete: input.beforeInfoComplete,
        featureAdjustment,
        featureAdjustmentBreakdown,
        candidateClassName: firstBoatFeature?.className,
        candidateMotorTop2Rate: firstBoatFeature?.motorTop2Rate,
        candidateBoatTop2Rate: firstBoatFeature?.boatTop2Rate,
        firstBoatFeature,
        secondBoatFeature,
        thirdBoatFeature,
      });
    }
    return candidates;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothedRate(count: number, total: number, alpha: number, buckets: number) {
  if (total <= 0) return 0;
  return (count + alpha) / (total + alpha * buckets);
}

function conservativeRate(rate: number, effectiveTotal: number) {
  if (effectiveTotal <= 0 || rate <= 0) return 0;
  const variance = rate * (1 - rate) / effectiveTotal;
  const lower = rate - DEFAULT_CONFIDENCE_Z * Math.sqrt(variance);
  return clamp(Number.isFinite(lower) ? lower : rate, 0, rate);
}

function parseSelection(value: string | null): [number, number, number] | null {
  const nums = String(value ?? "").match(/[1-6]/g)?.map(Number) ?? [];
  if (nums.length !== 3) return null;
  if (new Set(nums).size !== 3) return null;
  return nums as [number, number, number];
}
