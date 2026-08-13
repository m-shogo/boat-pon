import {
  evaluateN2Baseline,
  type N2BaselinePredictionRow,
} from "./n2BaselineEvaluation";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import type { N2HistoricalOnlyBaselineDataset } from "./n2HistoricalOnlyBaselineDataset";

export const N2_HISTORICAL_COMMON_COHORT_ALIGNMENT_VERSION =
  "n2-historical-common-cohort-alignment-v1" as const;

export type N2HistoricalCommonCohortAlignmentResult = {
  status: "PASS" | "BLOCKED";
  blockers: string[];
  alignmentVersion: typeof N2_HISTORICAL_COMMON_COHORT_ALIGNMENT_VERSION;
  alignedDecisionCutoffCount: number;
  dataset: N2HistoricalOnlyBaselineDataset;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function validDecisionCutoff(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    canonicalUtcTimestamp(value);
    return true;
  } catch {
    return false;
  }
}

function blockedDataset(
  dataset: N2HistoricalOnlyBaselineDataset,
  blockers: string[],
): N2HistoricalOnlyBaselineDataset {
  const rows: N2BaselinePredictionRow[] = [];
  const evaluation = evaluateN2Baseline(rows);
  const { outputDigest: _oldDigest, rows: _oldRows, evaluation: _oldEvaluation, ...rest } = dataset;
  const core = {
    ...rest,
    status: "BLOCKED" as const,
    blockers: unique(blockers),
    rowCount: 0,
    positiveCount: 0,
    rows,
    evaluation,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function alignN2HistoricalBaselineToDecisionCutoffs(input: {
  dataset: N2HistoricalOnlyBaselineDataset;
  decisionCutoffByRaceKey: Readonly<Record<string, string>>;
}): N2HistoricalCommonCohortAlignmentResult {
  if (input.dataset.status !== "PASS") {
    return {
      status: "BLOCKED",
      blockers: ["HISTORICAL_DATASET_NOT_PASS", ...input.dataset.blockers],
      alignmentVersion: N2_HISTORICAL_COMMON_COHORT_ALIGNMENT_VERSION,
      alignedDecisionCutoffCount: 0,
      dataset: input.dataset,
    };
  }
  const blockers: string[] = [];
  const raceKeys = [...new Set(input.dataset.rows.map((row) => row.canonicalRaceKey))].sort();
  for (const raceKey of raceKeys) {
    const cutoff = input.decisionCutoffByRaceKey[raceKey];
    if (!validDecisionCutoff(cutoff)) {
      blockers.push(`${raceKey}:DECISION_CUTOFF_MISSING_OR_INVALID`);
      continue;
    }
    const predictionAvailableAt = input.dataset.rows.find((row) => row.canonicalRaceKey === raceKey)?.predictionAvailableAt;
    if (!predictionAvailableAt || Date.parse(predictionAvailableAt) > Date.parse(cutoff)) {
      blockers.push(`${raceKey}:HISTORICAL_PREDICTION_AFTER_DECISION_CUTOFF`);
    }
  }
  if (blockers.length > 0) {
    return {
      status: "BLOCKED",
      blockers: unique(blockers),
      alignmentVersion: N2_HISTORICAL_COMMON_COHORT_ALIGNMENT_VERSION,
      alignedDecisionCutoffCount: 0,
      dataset: blockedDataset(input.dataset, blockers),
    };
  }

  const rows = input.dataset.rows.map((row) => ({
    ...row,
    decisionCutoff: input.decisionCutoffByRaceKey[row.canonicalRaceKey],
  }));
  const evaluation = evaluateN2Baseline(rows);
  if (evaluation.status !== "PASS") {
    const validationBlockers = [`ALIGNED_EVALUATION_${evaluation.status}`];
    return {
      status: "BLOCKED",
      blockers: validationBlockers,
      alignmentVersion: N2_HISTORICAL_COMMON_COHORT_ALIGNMENT_VERSION,
      alignedDecisionCutoffCount: raceKeys.length,
      dataset: blockedDataset(input.dataset, validationBlockers),
    };
  }
  const { outputDigest: _oldDigest, rows: _oldRows, evaluation: _oldEvaluation, ...rest } = input.dataset;
  const core = {
    ...rest,
    status: "PASS" as const,
    blockers: [] as string[],
    rows,
    evaluation,
  };
  const dataset = { ...core, outputDigest: canonicalHash(core) };
  return {
    status: "PASS",
    blockers: [],
    alignmentVersion: N2_HISTORICAL_COMMON_COHORT_ALIGNMENT_VERSION,
    alignedDecisionCutoffCount: raceKeys.length,
    dataset,
  };
}