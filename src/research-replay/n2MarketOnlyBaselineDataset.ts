import {
  buildMarketOnlyBaselineRow,
  evaluateN2Baseline,
  type N2BaselineEvaluationReport,
  type N2BaselinePredictionRow,
} from "./n2BaselineEvaluation";
import { canonicalHash } from "./canonical";

export const N2_MARKET_ONLY_BASELINE_DATASET_VERSION =
  "n2-market-only-baseline-dataset-v1" as const;
export const N2_MARKET_ONLY_BASELINE_ID = "n2-market-only-t5-v1" as const;
export const N2_MARKET_ONLY_BASELINE_COHORT_RACE_COUNT = 20;

export type N2MarketOnlyBaselineRaceSource = {
  canonicalRaceKey: string;
  decisionCutoff: string;
  capturedAt: string;
  availableAt: string;
  observationId: string;
  rawDocumentId: string;
  winningSelection: string;
  selections: Array<{
    selection: string;
    odds: number;
  }>;
};

export type N2MarketOnlyBaselineDataset = {
  datasetVersion: typeof N2_MARKET_ONLY_BASELINE_DATASET_VERSION;
  baselineId: typeof N2_MARKET_ONLY_BASELINE_ID;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  cohortPolicy: "earliest_20_clean_settled_accepted_t5_by_race_time";
  sourceRaceCount: number;
  cohortRaceCount: number;
  rowCount: number;
  positiveCount: number;
  rows: N2BaselinePredictionRow[];
  evaluation: N2BaselineEvaluationReport;
  cohortDigest: string;
  outputDigest: string;
};

type ParsedRaceKey = {
  date: string;
  venue: number;
  raceNo: number;
};

const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const SELECTION_RE = /^[1-6]-[1-6]-[1-6]$/u;

function parseRaceKey(value: string): ParsedRaceKey | null {
  const match = RACE_KEY_RE.exec(value);
  if (!match) return null;
  return {
    date: match[1],
    venue: Number(match[2]),
    raceNo: Number(match[3]),
  };
}

export function compareN2RaceKeysByRaceTime(left: string, right: string): number {
  const a = parseRaceKey(left);
  const b = parseRaceKey(right);
  if (!a || !b) return left.localeCompare(right);
  return a.date.localeCompare(b.date)
    || a.venue - b.venue
    || a.raceNo - b.raceNo;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function validateSource(source: N2MarketOnlyBaselineRaceSource): string[] {
  const blockers: string[] = [];
  if (!parseRaceKey(source.canonicalRaceKey)) blockers.push("RACE_KEY_INVALID");
  if (!Number.isFinite(Date.parse(source.decisionCutoff))) blockers.push("DECISION_CUTOFF_INVALID");
  if (!Number.isFinite(Date.parse(source.capturedAt))) blockers.push("CAPTURED_AT_INVALID");
  if (!Number.isFinite(Date.parse(source.availableAt))) blockers.push("AVAILABLE_AT_INVALID");
  if (Number.isFinite(Date.parse(source.availableAt))
    && Number.isFinite(Date.parse(source.decisionCutoff))
    && Date.parse(source.availableAt) > Date.parse(source.decisionCutoff)) {
    blockers.push("AVAILABLE_AFTER_DECISION_CUTOFF");
  }
  if (!source.observationId.trim()) blockers.push("OBSERVATION_ID_MISSING");
  if (!source.rawDocumentId.trim()) blockers.push("RAW_DOCUMENT_ID_MISSING");
  if (!SELECTION_RE.test(source.winningSelection)) blockers.push("WINNING_SELECTION_INVALID");
  if (source.selections.length !== 120) blockers.push("SELECTION_COUNT_NOT_120");

  const seen = new Set<string>();
  for (const row of source.selections) {
    if (!SELECTION_RE.test(row.selection)) blockers.push("SELECTION_ID_INVALID");
    const boats = row.selection.split("-");
    if (new Set(boats).size !== 3) blockers.push("SELECTION_DUPLICATE_BOAT");
    if (seen.has(row.selection)) blockers.push("SELECTION_DUPLICATE");
    seen.add(row.selection);
    if (!Number.isFinite(row.odds) || row.odds < 1) blockers.push("ODDS_INVALID");
  }
  if (!seen.has(source.winningSelection)) blockers.push("WINNING_SELECTION_NOT_IN_MARKET");
  return unique(blockers).sort();
}

function blockedDataset(input: {
  blockers: string[];
  sourceRaceCount: number;
  cohortRaceCount: number;
}): N2MarketOnlyBaselineDataset {
  const rows: N2BaselinePredictionRow[] = [];
  const evaluation = evaluateN2Baseline(rows);
  const cohortDigest = canonicalHash([]);
  const core = {
    datasetVersion: N2_MARKET_ONLY_BASELINE_DATASET_VERSION,
    baselineId: N2_MARKET_ONLY_BASELINE_ID,
    status: "BLOCKED" as const,
    blockers: unique(input.blockers).sort(),
    cohortPolicy: "earliest_20_clean_settled_accepted_t5_by_race_time" as const,
    sourceRaceCount: input.sourceRaceCount,
    cohortRaceCount: input.cohortRaceCount,
    rowCount: 0,
    positiveCount: 0,
    rows,
    evaluation,
    cohortDigest,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function buildN2MarketOnlyBaselineDataset(input: {
  sources: N2MarketOnlyBaselineRaceSource[];
  cohortRaceCount?: number;
}): N2MarketOnlyBaselineDataset {
  const cohortRaceCount = input.cohortRaceCount ?? N2_MARKET_ONLY_BASELINE_COHORT_RACE_COUNT;
  if (!Number.isSafeInteger(cohortRaceCount) || cohortRaceCount < 1) {
    throw new Error("N2_MARKET_ONLY_BASELINE_COHORT_RACE_COUNT_INVALID");
  }

  const byRace = new Map<string, N2MarketOnlyBaselineRaceSource>();
  const duplicateRaceKeys = new Set<string>();
  for (const source of input.sources) {
    if (byRace.has(source.canonicalRaceKey)) duplicateRaceKeys.add(source.canonicalRaceKey);
    else byRace.set(source.canonicalRaceKey, source);
  }
  if (duplicateRaceKeys.size > 0) {
    return blockedDataset({
      blockers: [`DUPLICATE_RACE_SOURCE:${duplicateRaceKeys.size}`],
      sourceRaceCount: byRace.size,
      cohortRaceCount,
    });
  }

  const ordered = [...byRace.values()]
    .sort((left, right) => compareN2RaceKeysByRaceTime(left.canonicalRaceKey, right.canonicalRaceKey));
  if (ordered.length < cohortRaceCount) {
    return blockedDataset({
      blockers: [`INSUFFICIENT_SETTLED_T5_RACES:${ordered.length}/${cohortRaceCount}`],
      sourceRaceCount: ordered.length,
      cohortRaceCount,
    });
  }
  const cohort = ordered.slice(0, cohortRaceCount);
  const sourceBlockers = cohort.flatMap((source) =>
    validateSource(source).map((blocker) => `${source.canonicalRaceKey}:${blocker}`),
  );
  if (sourceBlockers.length > 0) {
    return blockedDataset({
      blockers: sourceBlockers,
      sourceRaceCount: ordered.length,
      cohortRaceCount,
    });
  }

  const rows: N2BaselinePredictionRow[] = [];
  const buildBlockers: string[] = [];
  for (const source of cohort) {
    for (const selection of source.selections) {
      const built = buildMarketOnlyBaselineRow({
        baselineId: N2_MARKET_ONLY_BASELINE_ID,
        canonicalRaceKey: source.canonicalRaceKey,
        betType: "trifecta",
        betSelection: selection.selection,
        decisionCutoff: source.decisionCutoff,
        hit: selection.selection === source.winningSelection ? 1 : 0,
        odds: selection.odds,
        capturedAt: source.capturedAt,
        availableAt: source.availableAt,
        observationId: source.observationId,
        rawDocumentId: source.rawDocumentId,
      });
      if (built.status === "built") rows.push(built.row);
      else buildBlockers.push(...built.errors.map((error) => `${source.canonicalRaceKey}:${selection.selection}:${error}`));
    }
  }
  if (buildBlockers.length > 0) {
    return blockedDataset({
      blockers: buildBlockers,
      sourceRaceCount: ordered.length,
      cohortRaceCount,
    });
  }

  const evaluation = evaluateN2Baseline(rows);
  const cohortIdentities = cohort.map((source) => source.canonicalRaceKey);
  const cohortDigest = canonicalHash(cohortIdentities);
  const positiveCount = rows.reduce((sum, row) => sum + row.hit, 0);
  const core = {
    datasetVersion: N2_MARKET_ONLY_BASELINE_DATASET_VERSION,
    baselineId: N2_MARKET_ONLY_BASELINE_ID,
    status: evaluation.status === "PASS" ? "PASS" as const : "BLOCKED" as const,
    blockers: evaluation.status === "PASS" ? [] : [`EVALUATION_${evaluation.status}`],
    cohortPolicy: "earliest_20_clean_settled_accepted_t5_by_race_time" as const,
    sourceRaceCount: ordered.length,
    cohortRaceCount,
    rowCount: rows.length,
    positiveCount,
    rows,
    evaluation,
    cohortDigest,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
