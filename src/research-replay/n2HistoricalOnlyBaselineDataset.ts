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

export const N2_HISTORICAL_ONLY_BASELINE_DATASET_VERSION =
  "n2-historical-only-baseline-dataset-v1" as const;
export const N2_HISTORICAL_ONLY_BASELINE_ID =
  "n2-historical-venue-frequency-v1" as const;
export const N2_HISTORICAL_ONLY_MODEL_VERSION =
  "n2-historical-venue-frequency-eb-v1" as const;
export const N2_HISTORICAL_ONLY_FEATURE_CONTRACT_VERSION =
  "n2-historical-outcome-only-no-live-features-v1" as const;
export const N2_HISTORICAL_LOOKBACK_DAYS = 180;
export const N2_HISTORICAL_GLOBAL_LAPLACE_ALPHA = 1;
export const N2_HISTORICAL_VENUE_SHRINKAGE_PSEUDO_RACES = 30;
export const N2_HISTORICAL_MIN_GLOBAL_TRAINING_RACES = 120;
export const N2_HISTORICAL_MIN_VENUE_TRAINING_RACES = 30;
export const N2_HISTORICAL_EVALUATION_COHORT_RACE_COUNT = 20;

export type N2HistoricalOutcomeRow = {
  canonicalRaceKey: string;
  winningSelection: string;
};

export type N2HistoricalEvaluationRace = {
  canonicalRaceKey: string;
  winningSelection: string;
};

export type N2HistoricalTrainingProfile = {
  evaluationRaceKey: string;
  trainingToRaceKeyExclusive: string;
  trainingFromDateInclusive: string;
  trainingToDateExclusive: string;
  globalTrainingRaceCount: number;
  venueTrainingRaceCount: number;
  trainingSnapshotDigest: string;
};

export type N2HistoricalOnlyBaselineDataset = {
  datasetVersion: typeof N2_HISTORICAL_ONLY_BASELINE_DATASET_VERSION;
  baselineId: typeof N2_HISTORICAL_ONLY_BASELINE_ID;
  modelVersion: typeof N2_HISTORICAL_ONLY_MODEL_VERSION;
  featureContractVersion: typeof N2_HISTORICAL_ONLY_FEATURE_CONTRACT_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  cohortPolicy: "same_earliest_20_clean_settled_accepted_t5_races";
  modelPolicy: "prior_date_only_180d_global_prior_plus_venue_empirical_bayes";
  sourceTrainingRaceCount: number;
  sourceEvaluationRaceCount: number;
  cohortRaceCount: number;
  rowCount: number;
  positiveCount: number;
  rows: N2BaselinePredictionRow[];
  trainingProfiles: N2HistoricalTrainingProfile[];
  evaluation: N2BaselineEvaluationReport;
  cohortDigest: string;
  outputDigest: string;
};

type ParsedRaceKey = {
  date: string;
  venueCode: string;
  raceNo: number;
};

const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const SELECTION_RE = /^[1-6]-[1-6]-[1-6]$/u;
const TRIFECTA_SELECTIONS = enumerateBetSelections("trifecta");
const TRIFECTA_SELECTION_SET = new Set(TRIFECTA_SELECTIONS);

function parseRaceKey(value: string): ParsedRaceKey | null {
  const match = RACE_KEY_RE.exec(value);
  if (!match) return null;
  return { date: match[1], venueCode: match[2], raceNo: Number(match[3]) };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime())) throw new Error(`N2_HISTORICAL_DATE_INVALID:${date}`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function validateSelection(selection: string): boolean {
  if (!SELECTION_RE.test(selection) || !TRIFECTA_SELECTION_SET.has(selection)) return false;
  return new Set(selection.split("-")).size === 3;
}

function compareRaceKeys(left: string, right: string): number {
  const a = parseRaceKey(left);
  const b = parseRaceKey(right);
  if (!a || !b) return left.localeCompare(right);
  return a.date.localeCompare(b.date)
    || Number(a.venueCode) - Number(b.venueCode)
    || a.raceNo - b.raceNo;
}

function blockedDataset(input: {
  blockers: string[];
  sourceTrainingRaceCount: number;
  sourceEvaluationRaceCount: number;
  cohortRaceCount: number;
}): N2HistoricalOnlyBaselineDataset {
  const rows: N2BaselinePredictionRow[] = [];
  const evaluation = evaluateN2Baseline(rows);
  const core = {
    datasetVersion: N2_HISTORICAL_ONLY_BASELINE_DATASET_VERSION,
    baselineId: N2_HISTORICAL_ONLY_BASELINE_ID,
    modelVersion: N2_HISTORICAL_ONLY_MODEL_VERSION,
    featureContractVersion: N2_HISTORICAL_ONLY_FEATURE_CONTRACT_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(input.blockers),
    cohortPolicy: "same_earliest_20_clean_settled_accepted_t5_races" as const,
    modelPolicy: "prior_date_only_180d_global_prior_plus_venue_empirical_bayes" as const,
    sourceTrainingRaceCount: input.sourceTrainingRaceCount,
    sourceEvaluationRaceCount: input.sourceEvaluationRaceCount,
    cohortRaceCount: input.cohortRaceCount,
    rowCount: 0,
    positiveCount: 0,
    rows,
    trainingProfiles: [] as N2HistoricalTrainingProfile[],
    evaluation,
    cohortDigest: canonicalHash([]),
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function buildProbabilityMap(input: {
  evaluation: N2HistoricalEvaluationRace;
  training: N2HistoricalOutcomeRow[];
}): {
  probabilities: Map<string, number> | null;
  profile: N2HistoricalTrainingProfile;
  blockers: string[];
} {
  const parsedEvaluation = parseRaceKey(input.evaluation.canonicalRaceKey)!;
  const fromDate = addDays(parsedEvaluation.date, -N2_HISTORICAL_LOOKBACK_DAYS);
  // Strict PIT boundary: use only outcomes from dates before the evaluation date.
  // This avoids relying on race-order assumptions across venues on the same day.
  const globalTraining = input.training
    .filter((row) => {
      const parsed = parseRaceKey(row.canonicalRaceKey);
      return parsed != null
        && parsed.date >= fromDate
        && parsed.date < parsedEvaluation.date;
    })
    .sort((left, right) => compareRaceKeys(left.canonicalRaceKey, right.canonicalRaceKey));
  const venueTraining = globalTraining.filter((row) =>
    parseRaceKey(row.canonicalRaceKey)?.venueCode === parsedEvaluation.venueCode,
  );
  const snapshotDigest = canonicalHash(globalTraining.map((row) =>
    `${row.canonicalRaceKey}|${row.winningSelection}`,
  ));
  const profile: N2HistoricalTrainingProfile = {
    evaluationRaceKey: input.evaluation.canonicalRaceKey,
    trainingToRaceKeyExclusive: input.evaluation.canonicalRaceKey,
    trainingFromDateInclusive: fromDate,
    trainingToDateExclusive: parsedEvaluation.date,
    globalTrainingRaceCount: globalTraining.length,
    venueTrainingRaceCount: venueTraining.length,
    trainingSnapshotDigest: snapshotDigest,
  };
  const blockers: string[] = [];
  if (globalTraining.length < N2_HISTORICAL_MIN_GLOBAL_TRAINING_RACES) {
    blockers.push(`GLOBAL_TRAINING_TOO_SMALL:${globalTraining.length}/${N2_HISTORICAL_MIN_GLOBAL_TRAINING_RACES}`);
  }
  if (venueTraining.length < N2_HISTORICAL_MIN_VENUE_TRAINING_RACES) {
    blockers.push(`VENUE_TRAINING_TOO_SMALL:${parsedEvaluation.venueCode}:${venueTraining.length}/${N2_HISTORICAL_MIN_VENUE_TRAINING_RACES}`);
  }
  if (blockers.length > 0) return { probabilities: null, profile, blockers };

  const globalHits = new Map(TRIFECTA_SELECTIONS.map((selection) => [selection, 0]));
  const venueHits = new Map(TRIFECTA_SELECTIONS.map((selection) => [selection, 0]));
  for (const row of globalTraining) {
    globalHits.set(row.winningSelection, (globalHits.get(row.winningSelection) ?? 0) + 1);
  }
  for (const row of venueTraining) {
    venueHits.set(row.winningSelection, (venueHits.get(row.winningSelection) ?? 0) + 1);
  }

  const probabilities = new Map<string, number>();
  const globalDenominator = globalTraining.length
    + N2_HISTORICAL_GLOBAL_LAPLACE_ALPHA * TRIFECTA_SELECTIONS.length;
  const venueDenominator = venueTraining.length + N2_HISTORICAL_VENUE_SHRINKAGE_PSEUDO_RACES;
  for (const selection of TRIFECTA_SELECTIONS) {
    const globalProbability = (
      (globalHits.get(selection) ?? 0) + N2_HISTORICAL_GLOBAL_LAPLACE_ALPHA
    ) / globalDenominator;
    const probability = (
      (venueHits.get(selection) ?? 0)
      + N2_HISTORICAL_VENUE_SHRINKAGE_PSEUDO_RACES * globalProbability
    ) / venueDenominator;
    probabilities.set(selection, probability);
  }
  const probabilitySum = [...probabilities.values()].reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(probabilitySum) || Math.abs(probabilitySum - 1) > 1e-12) {
    return { probabilities: null, profile, blockers: [`PROBABILITY_SUM_INVALID:${probabilitySum}`] };
  }
  return { probabilities, profile, blockers: [] };
}

function buildHistoricalRow(input: {
  evaluation: N2HistoricalEvaluationRace;
  selection: string;
  probability: number;
  profile: N2HistoricalTrainingProfile;
}): { row: N2BaselinePredictionRow | null; errors: string[] } {
  const split = splitForN2RaceKey(input.evaluation.canonicalRaceKey);
  if (split == null) return { row: null, errors: ["INVALID_EVALUATION_RACE_KEY"] };
  const predictionAvailableAt = `${parseRaceKey(input.evaluation.canonicalRaceKey)!.date}T00:00:00+09:00`;
  const row: N2BaselinePredictionRow = {
    rowVersion: N2_BASELINE_ROW_VERSION,
    baselineId: N2_HISTORICAL_ONLY_BASELINE_ID,
    baselineKind: "historical_only",
    canonicalRaceKey: input.evaluation.canonicalRaceKey,
    betType: "trifecta",
    betSelection: input.selection,
    split,
    decisionCutoff: predictionAvailableAt,
    predictionAvailableAt,
    probability: input.probability,
    hit: input.selection === input.evaluation.winningSelection ? 1 : 0,
    provenance: {
      kind: "historical_only",
      modelVersion: N2_HISTORICAL_ONLY_MODEL_VERSION,
      featureContractVersion: N2_HISTORICAL_ONLY_FEATURE_CONTRACT_VERSION,
      trainingToRaceKeyExclusive: input.profile.trainingToRaceKeyExclusive,
      trainingSnapshotDigest: input.profile.trainingSnapshotDigest,
    },
  };
  const validation = validateN2BaselineRow(row);
  return validation.valid ? { row, errors: [] } : { row: null, errors: validation.errors };
}

export function buildN2HistoricalOnlyBaselineDataset(input: {
  training: N2HistoricalOutcomeRow[];
  evaluationRaces: N2HistoricalEvaluationRace[];
  cohortRaceCount?: number;
}): N2HistoricalOnlyBaselineDataset {
  const cohortRaceCount = input.cohortRaceCount ?? N2_HISTORICAL_EVALUATION_COHORT_RACE_COUNT;
  if (!Number.isSafeInteger(cohortRaceCount) || cohortRaceCount < 1) {
    throw new Error("N2_HISTORICAL_COHORT_RACE_COUNT_INVALID");
  }

  const trainingKeys = new Set<string>();
  const trainingBlockers: string[] = [];
  for (const row of input.training) {
    if (!parseRaceKey(row.canonicalRaceKey)) trainingBlockers.push(`${row.canonicalRaceKey}:TRAINING_RACE_KEY_INVALID`);
    if (!validateSelection(row.winningSelection)) trainingBlockers.push(`${row.canonicalRaceKey}:TRAINING_SELECTION_INVALID`);
    if (trainingKeys.has(row.canonicalRaceKey)) trainingBlockers.push(`${row.canonicalRaceKey}:DUPLICATE_TRAINING_RACE`);
    trainingKeys.add(row.canonicalRaceKey);
  }
  const evaluationByRace = new Map<string, N2HistoricalEvaluationRace>();
  const evaluationBlockers: string[] = [];
  for (const row of input.evaluationRaces) {
    if (!parseRaceKey(row.canonicalRaceKey)) evaluationBlockers.push(`${row.canonicalRaceKey}:EVALUATION_RACE_KEY_INVALID`);
    if (!validateSelection(row.winningSelection)) evaluationBlockers.push(`${row.canonicalRaceKey}:EVALUATION_SELECTION_INVALID`);
    if (evaluationByRace.has(row.canonicalRaceKey)) evaluationBlockers.push(`${row.canonicalRaceKey}:DUPLICATE_EVALUATION_RACE`);
    evaluationByRace.set(row.canonicalRaceKey, row);
  }
  if (trainingBlockers.length > 0 || evaluationBlockers.length > 0) {
    return blockedDataset({
      blockers: [...trainingBlockers, ...evaluationBlockers],
      sourceTrainingRaceCount: input.training.length,
      sourceEvaluationRaceCount: input.evaluationRaces.length,
      cohortRaceCount,
    });
  }

  const orderedEvaluation = [...evaluationByRace.values()]
    .sort((left, right) => compareRaceKeys(left.canonicalRaceKey, right.canonicalRaceKey));
  if (orderedEvaluation.length < cohortRaceCount) {
    return blockedDataset({
      blockers: [`EVALUATION_COHORT_TOO_SMALL:${orderedEvaluation.length}/${cohortRaceCount}`],
      sourceTrainingRaceCount: input.training.length,
      sourceEvaluationRaceCount: orderedEvaluation.length,
      cohortRaceCount,
    });
  }
  const cohort = orderedEvaluation.slice(0, cohortRaceCount);
  const rows: N2BaselinePredictionRow[] = [];
  const profiles: N2HistoricalTrainingProfile[] = [];
  const blockers: string[] = [];
  for (const evaluation of cohort) {
    const model = buildProbabilityMap({ evaluation, training: input.training });
    profiles.push(model.profile);
    if (!model.probabilities) {
      blockers.push(...model.blockers.map((blocker) => `${evaluation.canonicalRaceKey}:${blocker}`));
      continue;
    }
    for (const selection of TRIFECTA_SELECTIONS) {
      const built = buildHistoricalRow({
        evaluation,
        selection,
        probability: model.probabilities.get(selection)!,
        profile: model.profile,
      });
      if (built.row) rows.push(built.row);
      else blockers.push(...built.errors.map((error) => `${evaluation.canonicalRaceKey}:${selection}:${error}`));
    }
  }
  if (blockers.length > 0) {
    return blockedDataset({
      blockers,
      sourceTrainingRaceCount: input.training.length,
      sourceEvaluationRaceCount: orderedEvaluation.length,
      cohortRaceCount,
    });
  }

  const evaluation = evaluateN2Baseline(rows);
  const cohortDigest = canonicalHash(cohort.map((row) => row.canonicalRaceKey));
  const positiveCount = rows.reduce((sum, row) => sum + row.hit, 0);
  const core = {
    datasetVersion: N2_HISTORICAL_ONLY_BASELINE_DATASET_VERSION,
    baselineId: N2_HISTORICAL_ONLY_BASELINE_ID,
    modelVersion: N2_HISTORICAL_ONLY_MODEL_VERSION,
    featureContractVersion: N2_HISTORICAL_ONLY_FEATURE_CONTRACT_VERSION,
    status: evaluation.status === "PASS" ? "PASS" as const : "BLOCKED" as const,
    blockers: evaluation.status === "PASS" ? [] : [`EVALUATION_${evaluation.status}`],
    cohortPolicy: "same_earliest_20_clean_settled_accepted_t5_races" as const,
    modelPolicy: "prior_date_only_180d_global_prior_plus_venue_empirical_bayes" as const,
    sourceTrainingRaceCount: input.training.length,
    sourceEvaluationRaceCount: orderedEvaluation.length,
    cohortRaceCount,
    rowCount: rows.length,
    positiveCount,
    rows,
    trainingProfiles: profiles,
    evaluation,
    cohortDigest,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
