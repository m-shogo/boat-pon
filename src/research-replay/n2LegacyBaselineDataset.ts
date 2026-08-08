import { DEFAULT_MODEL_ALPHA, buildVenueModel } from "../domain/model";
import { MODEL_VERSION } from "../domain/modelVersion";
import type { RaceResult } from "../domain/types";
import {
  N2_BASELINE_ROW_VERSION,
  evaluateN2Baseline,
  splitForN2RaceKey,
  validateN2BaselineRow,
  type N2BaselineEvaluationReport,
  type N2BaselinePredictionRow,
} from "./n2BaselineEvaluation";
import { canonicalHash } from "./canonical";
import { enumerateBetSelections } from "./n2DatasetContract";
import type {
  N2HistoricalEvaluationRace,
  N2HistoricalOutcomeRow,
} from "./n2HistoricalOnlyBaselineDataset";

export const N2_LEGACY_BASELINE_DATASET_VERSION = "n2-legacy-baseline-dataset-v1" as const;
export const N2_LEGACY_BASELINE_ID = "n2-legacy-boatpon-v3-core-v1" as const;
export const N2_LEGACY_MODEL_VERSION = MODEL_VERSION;
export const N2_LEGACY_MODEL_ALPHA = DEFAULT_MODEL_ALPHA;
export const N2_LEGACY_CONFIDENCE_Z = 1.64;
export const N2_LEGACY_LOOKBACK_DAYS = 180;
export const N2_LEGACY_MIN_VENUE_TRAINING_RACES = 30;
export const N2_LEGACY_EVALUATION_COHORT_RACE_COUNT = 20;

export type N2LegacyTrainingProfile = {
  evaluationRaceKey: string;
  trainingFromDateInclusive: string;
  trainingToDateExclusive: string;
  venueTrainingRaceCount: number;
  trainingSnapshotDigest: string;
  decisionSnapshotId: string;
};

export type N2LegacyBaselineDataset = {
  datasetVersion: typeof N2_LEGACY_BASELINE_DATASET_VERSION;
  baselineId: typeof N2_LEGACY_BASELINE_ID;
  modelVersion: typeof N2_LEGACY_MODEL_VERSION;
  legacyScope: "boatpon_v3_alpha15_core_probability_surface_without_current_race_features_or_odds";
  status: "PASS" | "BLOCKED";
  blockers: string[];
  cohortPolicy: "same_earliest_20_clean_settled_accepted_t5_races";
  modelPolicy: "prior_date_only_180d_venue_alpha15_conservative_lower_bound";
  sourceTrainingRaceCount: number;
  sourceEvaluationRaceCount: number;
  cohortRaceCount: number;
  rowCount: number;
  positiveCount: number;
  rows: N2BaselinePredictionRow[];
  trainingProfiles: N2LegacyTrainingProfile[];
  evaluation: N2BaselineEvaluationReport;
  cohortDigest: string;
  outputDigest: string;
};

type ParsedRaceKey = { date: string; venueCode: string; raceNo: number };

const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const SELECTIONS = enumerateBetSelections("trifecta");
const SELECTION_SET = new Set(SELECTIONS);
const TRIFECTA_SPACE = SELECTIONS.length;

function parseRaceKey(value: string): ParsedRaceKey | null {
  const match = RACE_KEY_RE.exec(value);
  if (!match) return null;
  return { date: match[1], venueCode: match[2], raceNo: Number(match[3]) };
}

function compareRaceKeys(left: string, right: string): number {
  const a = parseRaceKey(left);
  const b = parseRaceKey(right);
  if (!a || !b) return left.localeCompare(right);
  return a.date.localeCompare(b.date)
    || Number(a.venueCode) - Number(b.venueCode)
    || a.raceNo - b.raceNo;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime())) throw new Error(`N2_LEGACY_DATE_INVALID:${date}`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function validSelection(selection: string): boolean {
  if (!SELECTION_SET.has(selection)) return false;
  return new Set(selection.split("-")).size === 3;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function legacySmoothedRate(hitCount: number, venueRaceCount: number): number {
  if (venueRaceCount <= 0) return 0;
  return (hitCount + N2_LEGACY_MODEL_ALPHA)
    / (venueRaceCount + N2_LEGACY_MODEL_ALPHA * TRIFECTA_SPACE);
}

export function legacyConservativeRate(hitCount: number, venueRaceCount: number): number {
  const rate = legacySmoothedRate(hitCount, venueRaceCount);
  if (rate <= 0) return 0;
  const effectiveTotal = venueRaceCount + N2_LEGACY_MODEL_ALPHA * TRIFECTA_SPACE;
  const variance = rate * (1 - rate) / effectiveTotal;
  const lower = rate - N2_LEGACY_CONFIDENCE_Z * Math.sqrt(variance);
  return clamp(Number.isFinite(lower) ? lower : rate, 0, rate);
}

function blocked(input: {
  blockers: string[];
  sourceTrainingRaceCount: number;
  sourceEvaluationRaceCount: number;
  cohortRaceCount: number;
}): N2LegacyBaselineDataset {
  const rows: N2BaselinePredictionRow[] = [];
  const evaluation = evaluateN2Baseline(rows);
  const core = {
    datasetVersion: N2_LEGACY_BASELINE_DATASET_VERSION,
    baselineId: N2_LEGACY_BASELINE_ID,
    modelVersion: N2_LEGACY_MODEL_VERSION,
    legacyScope: "boatpon_v3_alpha15_core_probability_surface_without_current_race_features_or_odds" as const,
    status: "BLOCKED" as const,
    blockers: [...new Set(input.blockers)].sort(),
    cohortPolicy: "same_earliest_20_clean_settled_accepted_t5_races" as const,
    modelPolicy: "prior_date_only_180d_venue_alpha15_conservative_lower_bound" as const,
    sourceTrainingRaceCount: input.sourceTrainingRaceCount,
    sourceEvaluationRaceCount: input.sourceEvaluationRaceCount,
    cohortRaceCount: input.cohortRaceCount,
    rowCount: 0,
    positiveCount: 0,
    rows,
    trainingProfiles: [] as N2LegacyTrainingProfile[],
    evaluation,
    cohortDigest: canonicalHash([]),
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function trainingForEvaluation(input: {
  training: N2HistoricalOutcomeRow[];
  evaluation: N2HistoricalEvaluationRace;
}): {
  rows: N2HistoricalOutcomeRow[];
  profile: N2LegacyTrainingProfile;
  blockers: string[];
} {
  const parsed = parseRaceKey(input.evaluation.canonicalRaceKey)!;
  const fromDate = addDays(parsed.date, -N2_LEGACY_LOOKBACK_DAYS);
  const rows = input.training
    .filter((row) => {
      const train = parseRaceKey(row.canonicalRaceKey);
      return train != null
        && train.venueCode === parsed.venueCode
        && train.date >= fromDate
        && train.date < parsed.date;
    })
    .sort((left, right) => compareRaceKeys(left.canonicalRaceKey, right.canonicalRaceKey));
  const trainingSnapshotDigest = canonicalHash(rows.map((row) => `${row.canonicalRaceKey}|${row.winningSelection}`));
  const decisionSnapshotId = `legacy-replay:${canonicalHash({
    modelVersion: N2_LEGACY_MODEL_VERSION,
    alpha: N2_LEGACY_MODEL_ALPHA,
    confidenceZ: N2_LEGACY_CONFIDENCE_Z,
    evaluationRaceKey: input.evaluation.canonicalRaceKey,
    trainingSnapshotDigest,
    currentRaceFeaturesUsed: false,
    marketOddsUsed: false,
  })}`;
  return {
    rows,
    profile: {
      evaluationRaceKey: input.evaluation.canonicalRaceKey,
      trainingFromDateInclusive: fromDate,
      trainingToDateExclusive: parsed.date,
      venueTrainingRaceCount: rows.length,
      trainingSnapshotDigest,
      decisionSnapshotId,
    },
    blockers: rows.length < N2_LEGACY_MIN_VENUE_TRAINING_RACES
      ? [`VENUE_TRAINING_TOO_SMALL:${parsed.venueCode}:${rows.length}/${N2_LEGACY_MIN_VENUE_TRAINING_RACES}`]
      : [],
  };
}

export function buildN2LegacyBaselineDataset(input: {
  training: N2HistoricalOutcomeRow[];
  evaluationRaces: N2HistoricalEvaluationRace[];
  decisionCutoffByRaceKey: Readonly<Record<string, string>>;
  cohortRaceCount?: number;
}): N2LegacyBaselineDataset {
  const cohortRaceCount = input.cohortRaceCount ?? N2_LEGACY_EVALUATION_COHORT_RACE_COUNT;
  if (!Number.isSafeInteger(cohortRaceCount) || cohortRaceCount < 1) {
    throw new Error("N2_LEGACY_COHORT_RACE_COUNT_INVALID");
  }
  const blockers: string[] = [];
  const trainingKeys = new Set<string>();
  for (const row of input.training) {
    if (!parseRaceKey(row.canonicalRaceKey)) blockers.push(`${row.canonicalRaceKey}:TRAINING_RACE_KEY_INVALID`);
    if (!validSelection(row.winningSelection)) blockers.push(`${row.canonicalRaceKey}:TRAINING_SELECTION_INVALID`);
    if (trainingKeys.has(row.canonicalRaceKey)) blockers.push(`${row.canonicalRaceKey}:DUPLICATE_TRAINING_RACE`);
    trainingKeys.add(row.canonicalRaceKey);
  }
  const evaluationByRace = new Map<string, N2HistoricalEvaluationRace>();
  for (const row of input.evaluationRaces) {
    if (!parseRaceKey(row.canonicalRaceKey)) blockers.push(`${row.canonicalRaceKey}:EVALUATION_RACE_KEY_INVALID`);
    if (!validSelection(row.winningSelection)) blockers.push(`${row.canonicalRaceKey}:EVALUATION_SELECTION_INVALID`);
    if (evaluationByRace.has(row.canonicalRaceKey)) blockers.push(`${row.canonicalRaceKey}:DUPLICATE_EVALUATION_RACE`);
    evaluationByRace.set(row.canonicalRaceKey, row);
  }
  const orderedEvaluation = [...evaluationByRace.values()]
    .sort((left, right) => compareRaceKeys(left.canonicalRaceKey, right.canonicalRaceKey));
  if (orderedEvaluation.length < cohortRaceCount) {
    blockers.push(`EVALUATION_COHORT_TOO_SMALL:${orderedEvaluation.length}/${cohortRaceCount}`);
  }
  if (blockers.length > 0) {
    return blocked({
      blockers,
      sourceTrainingRaceCount: input.training.length,
      sourceEvaluationRaceCount: orderedEvaluation.length,
      cohortRaceCount,
    });
  }

  const cohort = orderedEvaluation.slice(0, cohortRaceCount);
  const rows: N2BaselinePredictionRow[] = [];
  const profiles: N2LegacyTrainingProfile[] = [];
  for (const evaluationRace of cohort) {
    const training = trainingForEvaluation({ training: input.training, evaluation: evaluationRace });
    profiles.push(training.profile);
    if (training.blockers.length > 0) {
      blockers.push(...training.blockers.map((blocker) => `${evaluationRace.canonicalRaceKey}:${blocker}`));
      continue;
    }
    const decisionCutoff = input.decisionCutoffByRaceKey[evaluationRace.canonicalRaceKey];
    if (typeof decisionCutoff !== "string" || !Number.isFinite(Date.parse(decisionCutoff))) {
      blockers.push(`${evaluationRace.canonicalRaceKey}:DECISION_CUTOFF_MISSING_OR_INVALID`);
      continue;
    }
    const predictionAvailableAt = `${parseRaceKey(evaluationRace.canonicalRaceKey)!.date}T00:00:00+09:00`;
    if (Date.parse(predictionAvailableAt) > Date.parse(decisionCutoff)) {
      blockers.push(`${evaluationRace.canonicalRaceKey}:PREDICTION_AFTER_DECISION_CUTOFF`);
      continue;
    }
    const hitCounts = new Map(SELECTIONS.map((selection) => [selection, 0]));
    for (const row of training.rows) {
      hitCounts.set(row.winningSelection, (hitCounts.get(row.winningSelection) ?? 0) + 1);
    }
    const split = splitForN2RaceKey(evaluationRace.canonicalRaceKey);
    if (split == null) {
      blockers.push(`${evaluationRace.canonicalRaceKey}:SPLIT_INVALID`);
      continue;
    }
    for (const selection of SELECTIONS) {
      const row: N2BaselinePredictionRow = {
        rowVersion: N2_BASELINE_ROW_VERSION,
        baselineId: N2_LEGACY_BASELINE_ID,
        baselineKind: "legacy",
        canonicalRaceKey: evaluationRace.canonicalRaceKey,
        betType: "trifecta",
        betSelection: selection,
        split,
        decisionCutoff,
        predictionAvailableAt,
        probability: legacyConservativeRate(hitCounts.get(selection) ?? 0, training.rows.length),
        hit: selection === evaluationRace.winningSelection ? 1 : 0,
        provenance: {
          kind: "legacy",
          modelVersion: N2_LEGACY_MODEL_VERSION,
          decisionSnapshotId: training.profile.decisionSnapshotId,
        },
      };
      const validation = validateN2BaselineRow(row);
      if (!validation.valid) blockers.push(...validation.errors.map((error) => `${evaluationRace.canonicalRaceKey}:${selection}:${error}`));
      else rows.push(row);
    }
  }
  if (blockers.length > 0) {
    return blocked({
      blockers,
      sourceTrainingRaceCount: input.training.length,
      sourceEvaluationRaceCount: orderedEvaluation.length,
      cohortRaceCount,
    });
  }

  const evaluation = evaluateN2Baseline(rows);
  const core = {
    datasetVersion: N2_LEGACY_BASELINE_DATASET_VERSION,
    baselineId: N2_LEGACY_BASELINE_ID,
    modelVersion: N2_LEGACY_MODEL_VERSION,
    legacyScope: "boatpon_v3_alpha15_core_probability_surface_without_current_race_features_or_odds" as const,
    status: evaluation.status === "PASS" ? "PASS" as const : "BLOCKED" as const,
    blockers: evaluation.status === "PASS" ? [] : [`EVALUATION_${evaluation.status}`],
    cohortPolicy: "same_earliest_20_clean_settled_accepted_t5_races" as const,
    modelPolicy: "prior_date_only_180d_venue_alpha15_conservative_lower_bound" as const,
    sourceTrainingRaceCount: input.training.length,
    sourceEvaluationRaceCount: orderedEvaluation.length,
    cohortRaceCount,
    rowCount: rows.length,
    positiveCount: rows.reduce((sum, row) => sum + row.hit, 0),
    rows,
    trainingProfiles: profiles,
    evaluation,
    cohortDigest: canonicalHash(cohort.map((row) => row.canonicalRaceKey)),
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function assertLegacySurfaceMatchesCurrentModel(input: {
  training: N2HistoricalOutcomeRow[];
  venueCode: string;
}): { matchedObservedSelectionCount: number; mismatches: string[] } {
  const venueRows = input.training.filter((row) => parseRaceKey(row.canonicalRaceKey)?.venueCode === input.venueCode);
  const raceResults: RaceResult[] = venueRows.map((row) => {
    const parsed = parseRaceKey(row.canonicalRaceKey)!;
    return {
      raceId: `${parsed.date.replaceAll("-", "")}-${parsed.venueCode}-${String(parsed.raceNo).padStart(2, "0")}`,
      date: parsed.date,
      venue: parsed.venueCode,
      raceNo: parsed.raceNo,
      trifecta: row.winningSelection,
      payoutYen: null,
      popularity: null,
      returned: false,
      source: "n2-legacy-compatibility-test",
      fetchedAt: `${parsed.date}T23:59:59.000Z`,
    };
  });
  const current = buildVenueModel(raceResults, 1, N2_LEGACY_MODEL_ALPHA)
    .filter((row) => row.venue === input.venueCode);
  const hitCounts = new Map(SELECTIONS.map((selection) => [selection, 0]));
  for (const row of venueRows) hitCounts.set(row.winningSelection, (hitCounts.get(row.winningSelection) ?? 0) + 1);
  const mismatches: string[] = [];
  for (const row of current) {
    const reconstructed = legacyConservativeRate(hitCounts.get(row.selection) ?? 0, venueRows.length);
    if (Math.abs(reconstructed - row.conservativeHitRate) > 1e-15) {
      mismatches.push(`${row.selection}:${reconstructed}:${row.conservativeHitRate}`);
    }
  }
  return { matchedObservedSelectionCount: current.length, mismatches };
}
