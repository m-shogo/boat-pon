import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { canonicalHash } from "./canonical";
import { N2_TRIFECTA_MARKET_FEATURE_VERSION } from "./n2TrifectaMarketFeatureEngineering";
import { N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION } from
  "./n2TrifectaPrivateMarketFeatureArtifact";
import { N2_TRIFECTA_PRIVATE_MARKET_EXPERIMENT_INPUT_MANIFEST_VERSION } from
  "./n2TrifectaPrivateMarketExperimentInputManifest";

export const N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_MATRIX_VERSION =
  "n2-trifecta-private-market-exploration-matrix-v1" as const;
export const N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_FEATURE_SCHEMA_VERSION =
  "n2-trifecta-private-market-exploration-feature-schema-v1" as const;

const MAX_MANIFEST_BYTES = 5_000_000;
const MAX_FEATURE_ARTIFACT_BYTES = 20_000_000;
const MAX_MATRIX_BYTES = 20_000_000;
const CHECKPOINTS = ["T-30", "T-20", "T-10", "T-5"] as const;
const TRANSITIONS = [
  ["T-30", "T-20"],
  ["T-20", "T-10"],
  ["T-10", "T-5"],
] as const;

const SNAPSHOT_FIELDS = [
  "normalizedEntropy",
  "effectiveSelectionCount",
  "herfindahlIndex",
  "favoriteOdds",
  "favoriteGapRatio",
  "top1MassShare",
  "top3MassShare",
  "top5MassShare",
  "top10MassShare",
  "oddsP10",
  "oddsMedian",
  "oddsP90",
  "oddsSpreadP90P10",
] as const;

const TRANSITION_FIELDS = [
  "jensenShannonDivergenceBits",
  "totalVariationDistance",
  "favoriteChanged",
  "top5RetainedCount",
  "top5ChurnRate",
  "medianAbsoluteLogOddsMove",
  "maxAbsoluteLogOddsMove",
  "massWeightedAbsoluteLogOddsMove",
  "shorteningSelectionCount",
  "lengtheningSelectionCount",
  "unchangedSelectionCount",
] as const;

export const N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_COLUMNS = [
  ...CHECKPOINTS.flatMap((checkpoint) =>
    SNAPSHOT_FIELDS.map((field) => `${checkpoint}.${field}`)),
  ...TRANSITIONS.flatMap(([from, to]) =>
    TRANSITION_FIELDS.map((field) => `${from}->${to}.${field}`)),
] as const;

export const N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_FEATURE_SCHEMA_DIGEST =
  canonicalHash({
    schemaVersion: N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_FEATURE_SCHEMA_VERSION,
    columns: N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_COLUMNS,
  });

export type N2TrifectaPrivateMarketExplorationMatrixRow = {
  raceIdentity: string;
  featureArtifactDigest: string;
  sourceLoadDigest: string;
  values: number[];
};

export type N2TrifectaPrivateMarketExplorationMatrix = {
  matrixVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_MATRIX_VERSION;
  evidenceRole: "EXPLORATION_ONLY";
  labelPolicy: "NO_OUTCOME_LABELS";
  coveragePolicy: "FULL_TRAJECTORY_ONLY";
  manifestDigest: string;
  manifestVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_EXPERIMENT_INPUT_MANIFEST_VERSION;
  sourceAsOf: string;
  featureSchemaVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_FEATURE_SCHEMA_VERSION;
  featureSchemaDigest: string;
  columns: string[];
  raceCount: number;
  rows: N2TrifectaPrivateMarketExplorationMatrixRow[];
  privateResearchOnly: true;
  publicPublishAuthorized: false;
  privateFeatureArtifactsRead: true;
  rawCaptureEvidenceRead: false;
  rawOddsValuesPublished: false;
  outcomeDataRead: false;
  validationDataRead: false;
  holdoutDataRead: false;
  networkRequestCount: 0;
  databaseReadCount: 0;
  databaseWriteCount: 0;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  automatedBettingAuthorized: false;
  productionApplyAuthorized: false;
  matrixDigest: string;
};

type ManifestRaceLike = {
  raceIdentity?: unknown;
  date?: unknown;
  venueCode?: unknown;
  raceNo?: unknown;
  checkpointCoverage?: unknown;
  sourceLoadDigest?: unknown;
  featureArtifactDigest?: unknown;
  featureArtifactVersion?: unknown;
  featureArtifactRelativePath?: unknown;
};

type ManifestLike = {
  manifestVersion?: unknown;
  evidenceRole?: unknown;
  coveragePolicy?: unknown;
  labelPolicy?: unknown;
  selectionPolicy?: unknown;
  sourceAsOf?: unknown;
  sourceIndices?: unknown;
  raceCount?: unknown;
  races?: unknown;
  privateResearchOnly?: unknown;
  publicPublishAuthorized?: unknown;
  databaseReadCount?: unknown;
  databaseWriteCount?: unknown;
  networkRequestCount?: unknown;
  rawCaptureEvidenceRead?: unknown;
  rawOddsValuesPublished?: unknown;
  outcomeDataRead?: unknown;
  holdoutDataRead?: unknown;
  validationDataRead?: unknown;
  currentBuyConnectionAuthorized?: unknown;
  lineConnectionAuthorized?: unknown;
  automatedBettingAuthorized?: unknown;
  productionApplyAuthorized?: unknown;
  manifestDigest?: unknown;
};

type SequenceLike = {
  featureVersion?: unknown;
  status?: unknown;
  blockers?: unknown;
  raceIdentity?: unknown;
  availableCheckpoints?: unknown;
  missingCheckpoints?: unknown;
  snapshots?: unknown;
  transitions?: unknown;
  privateResearchOnly?: unknown;
  publicPublishAuthorized?: unknown;
  databaseWriteAuthorized?: unknown;
  outputDigest?: unknown;
};

type FeatureArtifactLike = {
  featureArtifactVersion?: unknown;
  generatedAt?: unknown;
  sourceLoadDigest?: unknown;
  raceIdentity?: unknown;
  status?: unknown;
  sequence?: SequenceLike | null;
  privateResearchOnly?: unknown;
  publicPublishAuthorized?: unknown;
  databaseWriteAuthorized?: unknown;
  currentBuyConnectionAuthorized?: unknown;
  lineConnectionAuthorized?: unknown;
  automatedBettingAuthorized?: unknown;
  artifactDigest?: unknown;
};

type SnapshotLike = Record<string, unknown> & {
  featureVersion?: unknown;
  raceIdentity?: unknown;
  checkpointLabel?: unknown;
  capturedAt?: unknown;
  availableAt?: unknown;
  selectionCount?: unknown;
  selections?: unknown;
  privateResearchOnly?: unknown;
  publicPublishAuthorized?: unknown;
  databaseWriteAuthorized?: unknown;
  outputDigest?: unknown;
};

type TransitionLike = Record<string, unknown> & {
  featureVersion?: unknown;
  raceIdentity?: unknown;
  fromCheckpoint?: unknown;
  toCheckpoint?: unknown;
  checkpointStepsApart?: unknown;
  capturedSecondsApart?: unknown;
  favoriteChanged?: unknown;
  top5RetainedCount?: unknown;
  shorteningSelectionCount?: unknown;
  lengtheningSelectionCount?: unknown;
  unchangedSelectionCount?: unknown;
  moves?: unknown;
  privateResearchOnly?: unknown;
  publicPublishAuthorized?: unknown;
  databaseWriteAuthorized?: unknown;
  outputDigest?: unknown;
};

function resolveInside(rootDir: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("EXPLORATION_MATRIX_PATH_UNSAFE");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("EXPLORATION_MATRIX_PATH_ESCAPES_ROOT");
  }
  return target;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function finiteNumber(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(code);
  return value;
}

function boundedNumber(value: unknown, minimum: number, maximum: number, code: string): number {
  const number = finiteNumber(value, code);
  if (number < minimum || number > maximum) throw new Error(code);
  return number;
}

function positiveNumber(value: unknown, code: string): number {
  const number = finiteNumber(value, code);
  if (number <= 0) throw new Error(code);
  return number;
}

function nonNegativeNumber(value: unknown, code: string): number {
  const number = finiteNumber(value, code);
  if (number < 0) throw new Error(code);
  return number;
}

function integerInRange(value: unknown, minimum: number, maximum: number, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(code);
  }
  return value as number;
}

function canonicalDigestMatches(value: Record<string, unknown>, digestField: string): boolean {
  const digest = value[digestField];
  if (!isDigest(digest)) return false;
  const core = { ...value };
  delete core[digestField];
  return canonicalHash(core) === digest;
}

function readManifest(input: {
  rootDir: string;
  manifestDigest: string;
}): ManifestLike & { manifestDigest: string; races: ManifestRaceLike[] } {
  if (!isDigest(input.manifestDigest)) throw new Error("EXPLORATION_MATRIX_MANIFEST_DIGEST_INVALID");
  const relativePath = `data/private/trifecta-market-experiments/manifests/${input.manifestDigest}.json`;
  const path = resolveInside(input.rootDir, relativePath);
  if (!existsSync(path)) throw new Error("EXPLORATION_MATRIX_MANIFEST_MISSING");
  const lst = lstatSync(path);
  if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("EXPLORATION_MATRIX_MANIFEST_FILE_TYPE_INVALID");
  const stat = statSync(path);
  if ((stat.mode & 0o777) !== 0o600) throw new Error("EXPLORATION_MATRIX_MANIFEST_FILE_MODE_INVALID");
  if (stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) throw new Error("EXPLORATION_MATRIX_MANIFEST_FILE_SIZE_INVALID");
  let manifest: ManifestLike;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8")) as ManifestLike;
  } catch {
    throw new Error("EXPLORATION_MATRIX_MANIFEST_JSON_INVALID");
  }
  if (manifest.manifestVersion !== N2_TRIFECTA_PRIVATE_MARKET_EXPERIMENT_INPUT_MANIFEST_VERSION
    || manifest.evidenceRole !== "EXPLORATION_ONLY"
    || manifest.coveragePolicy !== "FULL_TRAJECTORY_ONLY"
    || manifest.labelPolicy !== "NO_OUTCOME_LABELS"
    || manifest.selectionPolicy !== "ALL_PASS_RACES_FROM_EXPLICIT_DAY_INDICES") {
    throw new Error("EXPLORATION_MATRIX_MANIFEST_POLICY_INVALID");
  }
  if (manifest.manifestDigest !== input.manifestDigest || !canonicalDigestMatches(manifest as Record<string, unknown>, "manifestDigest")) {
    throw new Error("EXPLORATION_MATRIX_MANIFEST_DIGEST_MISMATCH");
  }
  if (typeof manifest.sourceAsOf !== "string" || !Number.isFinite(Date.parse(manifest.sourceAsOf))) {
    throw new Error("EXPLORATION_MATRIX_MANIFEST_SOURCE_AS_OF_INVALID");
  }
  if (!Array.isArray(manifest.sourceIndices) || !Array.isArray(manifest.races)) {
    throw new Error("EXPLORATION_MATRIX_MANIFEST_ARRAYS_INVALID");
  }
  if (!Number.isSafeInteger(manifest.raceCount) || manifest.raceCount !== manifest.races.length) {
    throw new Error("EXPLORATION_MATRIX_MANIFEST_RACE_COUNT_INVALID");
  }
  if (manifest.privateResearchOnly !== true || manifest.publicPublishAuthorized !== false
    || manifest.databaseReadCount !== 0 || manifest.databaseWriteCount !== 0 || manifest.networkRequestCount !== 0
    || manifest.rawCaptureEvidenceRead !== false || manifest.rawOddsValuesPublished !== false
    || manifest.outcomeDataRead !== false || manifest.validationDataRead !== false || manifest.holdoutDataRead !== false
    || manifest.currentBuyConnectionAuthorized !== false || manifest.lineConnectionAuthorized !== false
    || manifest.automatedBettingAuthorized !== false || manifest.productionApplyAuthorized !== false) {
    throw new Error("EXPLORATION_MATRIX_MANIFEST_BOUNDARY_INVALID");
  }
  return manifest as ManifestLike & { manifestDigest: string; races: ManifestRaceLike[] };
}

function validateSnapshot(input: {
  snapshot: SnapshotLike;
  raceIdentity: string;
  checkpoint: typeof CHECKPOINTS[number];
}): number[] {
  const value = input.snapshot;
  const code = `EXPLORATION_MATRIX_${input.checkpoint.replace("-", "")}`;
  if (value.featureVersion !== N2_TRIFECTA_MARKET_FEATURE_VERSION
    || value.raceIdentity !== input.raceIdentity || value.checkpointLabel !== input.checkpoint
    || value.selectionCount !== 120 || !Array.isArray(value.selections) || value.selections.length !== 120
    || value.privateResearchOnly !== true || value.publicPublishAuthorized !== false
    || value.databaseWriteAuthorized !== false || !canonicalDigestMatches(value, "outputDigest")) {
    throw new Error(`${code}_SNAPSHOT_INVALID`);
  }
  const capturedAt = typeof value.capturedAt === "string" ? Date.parse(value.capturedAt) : Number.NaN;
  const availableAt = typeof value.availableAt === "string" ? Date.parse(value.availableAt) : Number.NaN;
  if (!Number.isFinite(capturedAt) || !Number.isFinite(availableAt) || availableAt > capturedAt) {
    throw new Error(`${code}_PIT_TIME_INVALID`);
  }

  const normalizedEntropy = boundedNumber(value.normalizedEntropy, 0, 1, `${code}_NORMALIZED_ENTROPY_INVALID`);
  const effectiveSelectionCount = boundedNumber(value.effectiveSelectionCount, 1, 120, `${code}_EFFECTIVE_SELECTION_COUNT_INVALID`);
  const herfindahlIndex = boundedNumber(value.herfindahlIndex, 0, 1, `${code}_HERFINDAHL_INVALID`);
  const favoriteOdds = positiveNumber(value.favoriteOdds, `${code}_FAVORITE_ODDS_INVALID`);
  const favoriteGapRatio = boundedNumber(value.favoriteGapRatio, 1, Number.MAX_VALUE, `${code}_FAVORITE_GAP_INVALID`);
  const top1MassShare = boundedNumber(value.top1MassShare, 0, 1, `${code}_TOP1_INVALID`);
  const top3MassShare = boundedNumber(value.top3MassShare, 0, 1, `${code}_TOP3_INVALID`);
  const top5MassShare = boundedNumber(value.top5MassShare, 0, 1, `${code}_TOP5_INVALID`);
  const top10MassShare = boundedNumber(value.top10MassShare, 0, 1, `${code}_TOP10_INVALID`);
  if (!(top1MassShare <= top3MassShare && top3MassShare <= top5MassShare && top5MassShare <= top10MassShare)) {
    throw new Error(`${code}_TOP_MASS_ORDER_INVALID`);
  }
  const oddsP10 = positiveNumber(value.oddsP10, `${code}_P10_INVALID`);
  const oddsMedian = positiveNumber(value.oddsMedian, `${code}_MEDIAN_INVALID`);
  const oddsP90 = positiveNumber(value.oddsP90, `${code}_P90_INVALID`);
  if (!(oddsP10 <= oddsMedian && oddsMedian <= oddsP90)) throw new Error(`${code}_ODDS_QUANTILE_ORDER_INVALID`);
  const oddsSpreadP90P10 = boundedNumber(value.oddsSpreadP90P10, 1, Number.MAX_VALUE, `${code}_SPREAD_INVALID`);

  return [
    normalizedEntropy,
    effectiveSelectionCount,
    herfindahlIndex,
    favoriteOdds,
    favoriteGapRatio,
    top1MassShare,
    top3MassShare,
    top5MassShare,
    top10MassShare,
    oddsP10,
    oddsMedian,
    oddsP90,
    oddsSpreadP90P10,
  ];
}

function validateTransition(input: {
  transition: TransitionLike;
  raceIdentity: string;
  from: typeof CHECKPOINTS[number];
  to: typeof CHECKPOINTS[number];
}): number[] {
  const value = input.transition;
  const code = `EXPLORATION_MATRIX_${input.from.replace("-", "")}_TO_${input.to.replace("-", "")}`;
  if (value.featureVersion !== N2_TRIFECTA_MARKET_FEATURE_VERSION
    || value.raceIdentity !== input.raceIdentity || value.fromCheckpoint !== input.from || value.toCheckpoint !== input.to
    || value.checkpointStepsApart !== 1 || !Array.isArray(value.moves) || value.moves.length !== 120
    || value.privateResearchOnly !== true || value.publicPublishAuthorized !== false
    || value.databaseWriteAuthorized !== false || !canonicalDigestMatches(value, "outputDigest")) {
    throw new Error(`${code}_TRANSITION_INVALID`);
  }
  if (value.capturedSecondsApart !== null) nonNegativeNumber(value.capturedSecondsApart, `${code}_CAPTURE_SECONDS_INVALID`);
  const js = nonNegativeNumber(value.jensenShannonDivergenceBits, `${code}_JS_INVALID`);
  const tv = boundedNumber(value.totalVariationDistance, 0, 1, `${code}_TV_INVALID`);
  if (typeof value.favoriteChanged !== "boolean") throw new Error(`${code}_FAVORITE_CHANGED_INVALID`);
  const retained = integerInRange(value.top5RetainedCount, 0, 5, `${code}_TOP5_RETAINED_INVALID`);
  const churn = boundedNumber(value.top5ChurnRate, 0, 1, `${code}_TOP5_CHURN_INVALID`);
  const medianMove = nonNegativeNumber(value.medianAbsoluteLogOddsMove, `${code}_MEDIAN_MOVE_INVALID`);
  const maxMove = nonNegativeNumber(value.maxAbsoluteLogOddsMove, `${code}_MAX_MOVE_INVALID`);
  const weightedMove = nonNegativeNumber(value.massWeightedAbsoluteLogOddsMove, `${code}_WEIGHTED_MOVE_INVALID`);
  const shortening = integerInRange(value.shorteningSelectionCount, 0, 120, `${code}_SHORTENING_COUNT_INVALID`);
  const lengthening = integerInRange(value.lengtheningSelectionCount, 0, 120, `${code}_LENGTHENING_COUNT_INVALID`);
  const unchanged = integerInRange(value.unchangedSelectionCount, 0, 120, `${code}_UNCHANGED_COUNT_INVALID`);
  if (shortening + lengthening + unchanged !== 120) throw new Error(`${code}_MOVE_COUNTS_INVALID`);
  if (maxMove < medianMove) throw new Error(`${code}_MOVE_ORDER_INVALID`);

  return [
    js,
    tv,
    value.favoriteChanged ? 1 : 0,
    retained,
    churn,
    medianMove,
    maxMove,
    weightedMove,
    shortening,
    lengthening,
    unchanged,
  ];
}

function readFeatureArtifact(input: {
  rootDir: string;
  race: ManifestRaceLike;
}): N2TrifectaPrivateMarketExplorationMatrixRow {
  if (typeof input.race.raceIdentity !== "string" || !/^\d{8}-(0[1-9]|1\d|2[0-4])-\d{2}$/u.test(input.race.raceIdentity)) {
    throw new Error("EXPLORATION_MATRIX_RACE_IDENTITY_INVALID");
  }
  if (!isDigest(input.race.sourceLoadDigest) || !isDigest(input.race.featureArtifactDigest)
    || input.race.featureArtifactVersion !== N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION
    || typeof input.race.featureArtifactRelativePath !== "string") {
    throw new Error("EXPLORATION_MATRIX_RACE_LINEAGE_INVALID");
  }
  if (!Array.isArray(input.race.checkpointCoverage)
    || input.race.checkpointCoverage.length !== 4
    || CHECKPOINTS.some((checkpoint, index) => input.race.checkpointCoverage?.[index] !== checkpoint)) {
    throw new Error("EXPLORATION_MATRIX_RACE_COVERAGE_INVALID");
  }
  const path = resolveInside(input.rootDir, input.race.featureArtifactRelativePath);
  const expectedPath = `data/private/trifecta-market-features/${String(input.race.date)}/${String(input.race.venueCode)}/${String(input.race.raceNo).padStart(2, "0")}.json`;
  if (input.race.featureArtifactRelativePath !== expectedPath) throw new Error("EXPLORATION_MATRIX_FEATURE_PATH_MISMATCH");
  if (!existsSync(path)) throw new Error("EXPLORATION_MATRIX_FEATURE_MISSING");
  const lst = lstatSync(path);
  if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("EXPLORATION_MATRIX_FEATURE_FILE_TYPE_INVALID");
  const stat = statSync(path);
  if ((stat.mode & 0o777) !== 0o600) throw new Error("EXPLORATION_MATRIX_FEATURE_FILE_MODE_INVALID");
  if (stat.size <= 0 || stat.size > MAX_FEATURE_ARTIFACT_BYTES) throw new Error("EXPLORATION_MATRIX_FEATURE_FILE_SIZE_INVALID");
  let artifact: FeatureArtifactLike;
  try {
    artifact = JSON.parse(readFileSync(path, "utf8")) as FeatureArtifactLike;
  } catch {
    throw new Error("EXPLORATION_MATRIX_FEATURE_JSON_INVALID");
  }
  if (artifact.featureArtifactVersion !== N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION
    || artifact.raceIdentity !== input.race.raceIdentity || artifact.status !== "PASS"
    || artifact.sourceLoadDigest !== input.race.sourceLoadDigest || artifact.artifactDigest !== input.race.featureArtifactDigest
    || artifact.privateResearchOnly !== true || artifact.publicPublishAuthorized !== false
    || artifact.databaseWriteAuthorized !== false || artifact.currentBuyConnectionAuthorized !== false
    || artifact.lineConnectionAuthorized !== false || artifact.automatedBettingAuthorized !== false
    || !canonicalDigestMatches(artifact as Record<string, unknown>, "artifactDigest")) {
    throw new Error("EXPLORATION_MATRIX_FEATURE_ARTIFACT_INVALID");
  }
  if (typeof artifact.sequence !== "object" || artifact.sequence == null) throw new Error("EXPLORATION_MATRIX_SEQUENCE_MISSING");
  const sequence = artifact.sequence;
  if (sequence.featureVersion !== N2_TRIFECTA_MARKET_FEATURE_VERSION || sequence.status !== "PASS"
    || sequence.raceIdentity !== input.race.raceIdentity || !Array.isArray(sequence.blockers) || sequence.blockers.length !== 0
    || !Array.isArray(sequence.availableCheckpoints) || sequence.availableCheckpoints.length !== 4
    || CHECKPOINTS.some((checkpoint, index) => sequence.availableCheckpoints?.[index] !== checkpoint)
    || !Array.isArray(sequence.missingCheckpoints) || sequence.missingCheckpoints.length !== 0
    || !Array.isArray(sequence.snapshots) || sequence.snapshots.length !== 4
    || !Array.isArray(sequence.transitions) || sequence.transitions.length !== 3
    || sequence.privateResearchOnly !== true || sequence.publicPublishAuthorized !== false
    || sequence.databaseWriteAuthorized !== false || !canonicalDigestMatches(sequence as Record<string, unknown>, "outputDigest")) {
    throw new Error("EXPLORATION_MATRIX_SEQUENCE_INVALID");
  }

  const values: number[] = [];
  for (let index = 0; index < CHECKPOINTS.length; index += 1) {
    values.push(...validateSnapshot({
      snapshot: sequence.snapshots[index] as SnapshotLike,
      raceIdentity: input.race.raceIdentity,
      checkpoint: CHECKPOINTS[index],
    }));
  }
  for (let index = 0; index < TRANSITIONS.length; index += 1) {
    const [from, to] = TRANSITIONS[index];
    values.push(...validateTransition({
      transition: sequence.transitions[index] as TransitionLike,
      raceIdentity: input.race.raceIdentity,
      from,
      to,
    }));
  }
  if (values.length !== N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_COLUMNS.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error("EXPLORATION_MATRIX_VECTOR_INVALID");
  }
  return {
    raceIdentity: input.race.raceIdentity,
    featureArtifactDigest: input.race.featureArtifactDigest,
    sourceLoadDigest: input.race.sourceLoadDigest,
    values,
  };
}

export function buildN2TrifectaPrivateMarketExplorationMatrix(input: {
  rootDir: string;
  manifestDigest: string;
}): N2TrifectaPrivateMarketExplorationMatrix {
  const manifest = readManifest(input);
  const rows = manifest.races.map((race) => readFeatureArtifact({ rootDir: input.rootDir, race }));
  if (new Set(rows.map((row) => row.raceIdentity)).size !== rows.length) throw new Error("EXPLORATION_MATRIX_DUPLICATE_RACE");
  const core = {
    matrixVersion: N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_MATRIX_VERSION,
    evidenceRole: "EXPLORATION_ONLY" as const,
    labelPolicy: "NO_OUTCOME_LABELS" as const,
    coveragePolicy: "FULL_TRAJECTORY_ONLY" as const,
    manifestDigest: input.manifestDigest,
    manifestVersion: N2_TRIFECTA_PRIVATE_MARKET_EXPERIMENT_INPUT_MANIFEST_VERSION,
    sourceAsOf: new Date(Date.parse(manifest.sourceAsOf as string)).toISOString(),
    featureSchemaVersion: N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_FEATURE_SCHEMA_VERSION,
    featureSchemaDigest: N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_FEATURE_SCHEMA_DIGEST,
    columns: [...N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_COLUMNS],
    raceCount: rows.length,
    rows,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
    privateFeatureArtifactsRead: true as const,
    rawCaptureEvidenceRead: false as const,
    rawOddsValuesPublished: false as const,
    outcomeDataRead: false as const,
    validationDataRead: false as const,
    holdoutDataRead: false as const,
    networkRequestCount: 0 as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    productionApplyAuthorized: false as const,
  };
  return { ...core, matrixDigest: canonicalHash(core) };
}

export function privateMarketExplorationMatrixRelativePath(input: {
  manifestDigest: string;
  matrixDigest: string;
}): string {
  if (!isDigest(input.manifestDigest) || !isDigest(input.matrixDigest)) throw new Error("EXPLORATION_MATRIX_DIGEST_INVALID");
  return `data/private/trifecta-market-experiments/matrices/${input.manifestDigest}/${input.matrixDigest}.json`;
}

export function writeN2TrifectaPrivateMarketExplorationMatrix(input: {
  rootDir: string;
  matrix: N2TrifectaPrivateMarketExplorationMatrix;
}): { relativePath: string; created: boolean; matrixDigest: string; fileMode: 0o600 } {
  const relativePath = privateMarketExplorationMatrixRelativePath(input.matrix);
  const path = resolveInside(input.rootDir, relativePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const parent = lstatSync(dirname(path));
  if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error("EXPLORATION_MATRIX_PARENT_INVALID");
  if (existsSync(path)) {
    const lst = lstatSync(path);
    if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("EXPLORATION_MATRIX_FILE_TYPE_INVALID");
    const stat = statSync(path);
    if ((stat.mode & 0o777) !== 0o600 || stat.size <= 0 || stat.size > MAX_MATRIX_BYTES) {
      throw new Error("EXPLORATION_MATRIX_EXISTING_FILE_INVALID");
    }
    let existing: unknown;
    try {
      existing = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error("EXPLORATION_MATRIX_EXISTING_JSON_INVALID");
    }
    if (canonicalHash(existing) !== canonicalHash(input.matrix)) throw new Error("EXPLORATION_MATRIX_COLLISION");
    return { relativePath, created: false, matrixDigest: input.matrix.matrixDigest, fileMode: 0o600 };
  }
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(input.matrix, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error("EXPLORATION_MATRIX_FINAL_MODE_INVALID");
  return { relativePath, created: true, matrixDigest: input.matrix.matrixDigest, fileMode: 0o600 };
}
