import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import {
  enumerateBetSelections,
  validateOddsUsage,
} from "./n2DatasetContract";
import type { SettlementBetType } from "./settlement";

export const N2_BASELINE_EVALUATION_VERSION = "n2-baseline-evaluation-v1";
export const N2_BASELINE_ROW_VERSION = "n2-baseline-row-v1";

export type N2BaselineKind = "market_only" | "historical_only" | "legacy";
export type N2EvaluationSplit = "train" | "validation" | "test" | "forward_shadow";

export type N2MarketBaselineProvenance = {
  kind: "market_only";
  odds: number;
  probabilityMethod: "reciprocal_odds_raw";
  capturedAt: string;
  availableAt: string;
  observationId: string;
  rawDocumentId: string;
};

export type N2HistoricalBaselineProvenance = {
  kind: "historical_only";
  modelVersion: string;
  featureContractVersion: string;
  trainingToRaceKeyExclusive: string;
  trainingSnapshotDigest: string;
};

export type N2LegacyBaselineProvenance = {
  kind: "legacy";
  modelVersion: string;
  decisionSnapshotId: string;
};

export type N2BaselineProvenance =
  | N2MarketBaselineProvenance
  | N2HistoricalBaselineProvenance
  | N2LegacyBaselineProvenance;

export type N2BaselinePredictionRow = {
  rowVersion: typeof N2_BASELINE_ROW_VERSION;
  baselineId: string;
  baselineKind: N2BaselineKind;
  canonicalRaceKey: string;
  betType: SettlementBetType;
  betSelection: string;
  split: N2EvaluationSplit;
  decisionCutoff: string;
  predictionAvailableAt: string;
  probability: number;
  hit: 0 | 1;
  provenance: N2BaselineProvenance;
};

export type N2BaselineValidationResult = {
  valid: boolean;
  errors: string[];
};

export type N2CalibrationBin = {
  binIndex: number;
  lowerInclusive: number;
  upperInclusive: number;
  count: number;
  meanProbability: number | null;
  observedRate: number | null;
  absoluteGap: number | null;
};

export type N2BaselineMetrics = {
  rowCount: number;
  positiveCount: number;
  positiveRate: number | null;
  meanProbability: number | null;
  logLoss: number | null;
  brierScore: number | null;
  expectedCalibrationError: number | null;
  calibrationBins: N2CalibrationBin[];
};

export type N2BaselineEvaluationReport = {
  evaluationVersion: typeof N2_BASELINE_EVALUATION_VERSION;
  baselineId: string;
  baselineKind: N2BaselineKind;
  status: "PASS" | "CONDITIONAL" | "FAILED";
  rowCount: number;
  splitCounts: Record<N2EvaluationSplit, number>;
  metrics: N2BaselineMetrics;
  metricsBySplit: Record<N2EvaluationSplit, N2BaselineMetrics>;
  rowSetDigest: string;
  outputDigest: string;
};

export type N2CommonCohortComparison = {
  comparisonVersion: "n2-common-cohort-comparison-v1";
  status: "COMPARABLE" | "INSUFFICIENT_COMMON_COHORT" | "CONFLICT" | "INVALID";
  baselineIds: string[];
  inputCounts: Record<string, number>;
  commonRowCount: number;
  excludedOutsideCommonCohort: Record<string, number>;
  minimumCommonRows: number;
  conflicts: string[];
  reports: Record<string, N2BaselineEvaluationReport>;
  commonCohortDigest: string;
  outputDigest: string;
};

const BASELINE_ID_RE = /^[0-9A-Za-z][0-9A-Za-z._:-]{2,127}$/;
const RACE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2}):(\d{2}):R(\d{1,2})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const EPSILON = 1e-15;
const CALIBRATION_BIN_COUNT = 10;

function validTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59) return false;
  const offset = /([+-])(\d{2}):(\d{2})$/i.exec(value);
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return false;
  try {
    canonicalUtcTimestamp(value);
    return true;
  } catch {
    return false;
  }
}

function raceDate(canonicalRaceKey: string): string | null {
  const match = RACE_KEY_RE.exec(canonicalRaceKey);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const venue = Number(match[4]);
  const raceNo = Number(match[5]);
  const parsedDate = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== date) return null;
  if (!Number.isInteger(venue) || venue < 1 || venue > 24) return null;
  if (!Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) return null;
  return date;
}

export function splitForN2RaceKey(canonicalRaceKey: string): N2EvaluationSplit | null {
  const date = raceDate(canonicalRaceKey);
  if (date === null) return null;
  if (date < "2022-01-01") return "train";
  if (date < "2024-01-01") return "validation";
  if (date < "2026-01-01") return "test";
  return "forward_shadow";
}

export function n2BaselineRowIdentity(row: Pick<
  N2BaselinePredictionRow,
  "canonicalRaceKey" | "betType" | "betSelection" | "split"
>): string {
  return `${row.canonicalRaceKey}|${row.betType}|${row.betSelection}|${row.split}`;
}

function probabilityMatchesOdds(probability: number, odds: number): boolean {
  const expected = Math.min(1, 1 / odds);
  return Math.abs(probability - expected) <= 1e-12;
}

export function validateN2BaselineRow(row: N2BaselinePredictionRow): N2BaselineValidationResult {
  const errors: string[] = [];
  if (row.rowVersion !== N2_BASELINE_ROW_VERSION) errors.push(`rowVersion must be ${N2_BASELINE_ROW_VERSION}`);
  if (!BASELINE_ID_RE.test(row.baselineId)) errors.push("invalid baselineId");
  const expectedSplit = splitForN2RaceKey(row.canonicalRaceKey);
  if (expectedSplit === null) errors.push("invalid canonicalRaceKey");
  else if (row.split !== expectedSplit) errors.push(`split mismatch: expected ${expectedSplit}`);

  const canonicalSelections = new Set(enumerateBetSelections(row.betType));
  if (!canonicalSelections.has(row.betSelection)) errors.push("noncanonical betSelection");
  if (!validTimestamp(row.decisionCutoff)) errors.push("invalid decisionCutoff");
  if (!validTimestamp(row.predictionAvailableAt)) errors.push("invalid predictionAvailableAt");
  if (validTimestamp(row.decisionCutoff) && validTimestamp(row.predictionAvailableAt)
    && Date.parse(row.predictionAvailableAt) > Date.parse(row.decisionCutoff)) {
    errors.push("prediction available after decision cutoff");
  }
  if (!Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1) {
    errors.push("probability must be within [0,1]");
  }
  if (row.hit !== 0 && row.hit !== 1) errors.push("hit must be 0 or 1");
  if (row.baselineKind !== row.provenance.kind) errors.push("baselineKind/provenance mismatch");

  if (row.provenance.kind === "market_only") {
    const source = row.provenance;
    if (!Number.isFinite(source.odds) || source.odds < 1) errors.push("market odds must be >= 1");
    if (source.probabilityMethod !== "reciprocal_odds_raw") errors.push("unsupported market probability method");
    if (!source.observationId || !source.rawDocumentId) errors.push("market provenance IDs are required");
    const timing = validateOddsUsage({
      kind: "live_checkpoint",
      role: "feature",
      capturedAt: source.capturedAt,
      availableAt: source.availableAt,
      decisionCutoff: row.decisionCutoff,
    });
    if (!timing.usable) errors.push(timing.reason);
    if (validTimestamp(source.availableAt) && validTimestamp(row.predictionAvailableAt)
      && Date.parse(source.availableAt) !== Date.parse(row.predictionAvailableAt)) {
      errors.push("predictionAvailableAt must equal market availableAt");
    }
    if (Number.isFinite(source.odds) && source.odds >= 1
      && Number.isFinite(row.probability) && !probabilityMatchesOdds(row.probability, source.odds)) {
      errors.push("market probability does not match reciprocal odds");
    }
  } else if (row.provenance.kind === "historical_only") {
    const source = row.provenance;
    if (!source.modelVersion || !source.featureContractVersion) errors.push("historical model identity is required");
    if (raceDate(source.trainingToRaceKeyExclusive) === null) errors.push("invalid trainingToRaceKeyExclusive");
    if (source.trainingToRaceKeyExclusive > row.canonicalRaceKey) errors.push("historical training boundary reaches evaluation row");
    if (!SHA256_RE.test(source.trainingSnapshotDigest)) errors.push("invalid trainingSnapshotDigest");
  } else {
    const source = row.provenance;
    if (!source.modelVersion || !source.decisionSnapshotId) errors.push("legacy source identity is required");
  }

  return { valid: errors.length === 0, errors };
}

export function validateN2BaselineRows(rows: N2BaselinePredictionRow[]): N2BaselineValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  let baselineId: string | null = null;
  let baselineKind: N2BaselineKind | null = null;
  for (const [index, row] of rows.entries()) {
    const validation = validateN2BaselineRow(row);
    errors.push(...validation.errors.map((error) => `rows[${index}]: ${error}`));
    baselineId ??= row.baselineId;
    baselineKind ??= row.baselineKind;
    if (row.baselineId !== baselineId) errors.push(`rows[${index}]: mixed baselineId`);
    if (row.baselineKind !== baselineKind) errors.push(`rows[${index}]: mixed baselineKind`);
    const identity = n2BaselineRowIdentity(row);
    if (seen.has(identity)) errors.push(`rows[${index}]: duplicate identity ${identity}`);
    seen.add(identity);
  }
  return { valid: errors.length === 0, errors };
}

export function buildMarketOnlyBaselineRow(input: {
  baselineId: string;
  canonicalRaceKey: string;
  betType: SettlementBetType;
  betSelection: string;
  decisionCutoff: string;
  hit: 0 | 1;
  odds: number;
  capturedAt: string;
  availableAt: string;
  observationId: string;
  rawDocumentId: string;
}): { status: "built"; row: N2BaselinePredictionRow } | { status: "excluded"; errors: string[] } {
  const split = splitForN2RaceKey(input.canonicalRaceKey);
  if (split === null) return { status: "excluded", errors: ["invalid canonicalRaceKey"] };
  const row: N2BaselinePredictionRow = {
    rowVersion: N2_BASELINE_ROW_VERSION,
    baselineId: input.baselineId,
    baselineKind: "market_only",
    canonicalRaceKey: input.canonicalRaceKey,
    betType: input.betType,
    betSelection: input.betSelection,
    split,
    decisionCutoff: input.decisionCutoff,
    predictionAvailableAt: input.availableAt,
    probability: Number.isFinite(input.odds) && input.odds > 0 ? Math.min(1, 1 / input.odds) : Number.NaN,
    hit: input.hit,
    provenance: {
      kind: "market_only",
      odds: input.odds,
      probabilityMethod: "reciprocal_odds_raw",
      capturedAt: input.capturedAt,
      availableAt: input.availableAt,
      observationId: input.observationId,
      rawDocumentId: input.rawDocumentId,
    },
  };
  const validation = validateN2BaselineRow(row);
  return validation.valid ? { status: "built", row } : { status: "excluded", errors: validation.errors };
}

function emptyMetrics(): N2BaselineMetrics {
  return {
    rowCount: 0,
    positiveCount: 0,
    positiveRate: null,
    meanProbability: null,
    logLoss: null,
    brierScore: null,
    expectedCalibrationError: null,
    calibrationBins: Array.from({ length: CALIBRATION_BIN_COUNT }, (_, binIndex) => ({
      binIndex,
      lowerInclusive: binIndex / CALIBRATION_BIN_COUNT,
      upperInclusive: (binIndex + 1) / CALIBRATION_BIN_COUNT,
      count: 0,
      meanProbability: null,
      observedRate: null,
      absoluteGap: null,
    })),
  };
}

export function calculateN2BaselineMetrics(rows: N2BaselinePredictionRow[]): N2BaselineMetrics {
  if (rows.length === 0) return emptyMetrics();
  let positiveCount = 0;
  let probabilitySum = 0;
  let logLossSum = 0;
  let brierSum = 0;
  const bins = Array.from({ length: CALIBRATION_BIN_COUNT }, () => ({ count: 0, probabilitySum: 0, hitSum: 0 }));

  for (const row of rows) {
    positiveCount += row.hit;
    probabilitySum += row.probability;
    const bounded = Math.min(1 - EPSILON, Math.max(EPSILON, row.probability));
    logLossSum += -(row.hit * Math.log(bounded) + (1 - row.hit) * Math.log(1 - bounded));
    brierSum += (row.probability - row.hit) ** 2;
    const binIndex = Math.min(CALIBRATION_BIN_COUNT - 1, Math.floor(row.probability * CALIBRATION_BIN_COUNT));
    bins[binIndex].count += 1;
    bins[binIndex].probabilitySum += row.probability;
    bins[binIndex].hitSum += row.hit;
  }

  const calibrationBins = bins.map((bin, binIndex): N2CalibrationBin => {
    const meanProbability = bin.count === 0 ? null : bin.probabilitySum / bin.count;
    const observedRate = bin.count === 0 ? null : bin.hitSum / bin.count;
    return {
      binIndex,
      lowerInclusive: binIndex / CALIBRATION_BIN_COUNT,
      upperInclusive: (binIndex + 1) / CALIBRATION_BIN_COUNT,
      count: bin.count,
      meanProbability,
      observedRate,
      absoluteGap: meanProbability === null || observedRate === null ? null : Math.abs(meanProbability - observedRate),
    };
  });
  const expectedCalibrationError = calibrationBins.reduce(
    (sum, bin) => sum + (bin.absoluteGap ?? 0) * bin.count / rows.length,
    0,
  );
  return {
    rowCount: rows.length,
    positiveCount,
    positiveRate: positiveCount / rows.length,
    meanProbability: probabilitySum / rows.length,
    logLoss: logLossSum / rows.length,
    brierScore: brierSum / rows.length,
    expectedCalibrationError,
    calibrationBins,
  };
}

const SPLITS: N2EvaluationSplit[] = ["train", "validation", "test", "forward_shadow"];

export function evaluateN2Baseline(rows: N2BaselinePredictionRow[]): N2BaselineEvaluationReport {
  const validation = validateN2BaselineRows(rows);
  const baselineId = rows[0]?.baselineId ?? "empty-baseline";
  const baselineKind = rows[0]?.baselineKind ?? "legacy";
  const ordered = [...rows].sort((a, b) => n2BaselineRowIdentity(a).localeCompare(n2BaselineRowIdentity(b)));
  const splitCounts = Object.fromEntries(SPLITS.map((split) => [split, ordered.filter((row) => row.split === split).length])) as Record<N2EvaluationSplit, number>;
  const metricsBySplit = Object.fromEntries(SPLITS.map((split) => [
    split,
    calculateN2BaselineMetrics(ordered.filter((row) => row.split === split)),
  ])) as Record<N2EvaluationSplit, N2BaselineMetrics>;
  const status = !validation.valid ? "FAILED" : ordered.length === 0 ? "CONDITIONAL" : "PASS";
  const rowSetDigest = canonicalHash(ordered);
  const withoutDigest = {
    evaluationVersion: N2_BASELINE_EVALUATION_VERSION,
    baselineId,
    baselineKind,
    status,
    rowCount: ordered.length,
    splitCounts,
    metrics: calculateN2BaselineMetrics(ordered),
    metricsBySplit,
    rowSetDigest,
  } satisfies Omit<N2BaselineEvaluationReport, "outputDigest">;
  return { ...withoutDigest, outputDigest: canonicalHash(withoutDigest) };
}

export function compareN2BaselinesOnCommonCohort(input: {
  baselines: Record<string, N2BaselinePredictionRow[]>;
  minimumCommonRows?: number;
}): N2CommonCohortComparison {
  const minimumCommonRows = input.minimumCommonRows ?? 100;
  if (!Number.isInteger(minimumCommonRows) || minimumCommonRows < 1) {
    throw new Error("minimumCommonRows must be a positive integer");
  }
  const baselineIds = Object.keys(input.baselines).sort();
  const inputCounts = Object.fromEntries(baselineIds.map((id) => [id, input.baselines[id].length]));
  const conflicts: string[] = [];
  const maps = new Map<string, Map<string, N2BaselinePredictionRow>>();

  for (const baselineId of baselineIds) {
    const rows = input.baselines[baselineId];
    const validation = validateN2BaselineRows(rows);
    if (!validation.valid) conflicts.push(...validation.errors.map((error) => `${baselineId}: ${error}`));
    if (rows.some((row) => row.baselineId !== baselineId)) conflicts.push(`${baselineId}: map key/baselineId mismatch`);
    maps.set(baselineId, new Map(rows.map((row) => [n2BaselineRowIdentity(row), row])));
  }

  const commonIdentities = baselineIds.length === 0
    ? []
    : [...(maps.get(baselineIds[0])?.keys() ?? [])].filter((identity) =>
        baselineIds.every((baselineId) => maps.get(baselineId)?.has(identity)),
      ).sort();

  for (const identity of commonIdentities) {
    const rows = baselineIds.map((baselineId) => maps.get(baselineId)!.get(identity)!);
    const first = rows[0];
    if (rows.some((row) => row.hit !== first.hit)) conflicts.push(`${identity}: label mismatch`);
    if (rows.some((row) => row.decisionCutoff !== first.decisionCutoff)) conflicts.push(`${identity}: decisionCutoff mismatch`);
  }

  const reports = Object.fromEntries(baselineIds.map((baselineId) => {
    const rows = commonIdentities.map((identity) => maps.get(baselineId)!.get(identity)!);
    return [baselineId, evaluateN2Baseline(rows)];
  }));
  const excludedOutsideCommonCohort = Object.fromEntries(
    baselineIds.map((baselineId) => [baselineId, input.baselines[baselineId].length - commonIdentities.length]),
  );
  const status: N2CommonCohortComparison["status"] = conflicts.length > 0
    ? "CONFLICT"
    : baselineIds.length < 2
      ? "INVALID"
      : commonIdentities.length < minimumCommonRows
        ? "INSUFFICIENT_COMMON_COHORT"
        : "COMPARABLE";
  const commonCohortDigest = canonicalHash(commonIdentities);
  const withoutDigest: Omit<N2CommonCohortComparison, "outputDigest"> = {
    comparisonVersion: "n2-common-cohort-comparison-v1",
    status,
    baselineIds,
    inputCounts,
    commonRowCount: commonIdentities.length,
    excludedOutsideCommonCohort,
    minimumCommonRows,
    conflicts: [...new Set(conflicts)].sort(),
    reports,
    commonCohortDigest,
  };
  return { ...withoutDigest, outputDigest: canonicalHash(withoutDigest) };
}