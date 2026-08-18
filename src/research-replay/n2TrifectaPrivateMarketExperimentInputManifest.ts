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

import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION } from
  "./n2TrifectaPrivateMarketFeatureArtifact";
import { N2_TRIFECTA_PRIVATE_MARKET_FEATURE_DAY_INDEX_VERSION } from
  "./n2TrifectaPrivateMarketFeatureDayIndex";

export const N2_TRIFECTA_PRIVATE_MARKET_EXPERIMENT_INPUT_MANIFEST_VERSION =
  "n2-trifecta-private-market-experiment-input-manifest-v1" as const;

const MAX_DAY_INDEX_BYTES = 5_000_000;
const MAX_MANIFEST_BYTES = 5_000_000;
const CHECKPOINTS = ["T-30", "T-20", "T-10", "T-5"] as const;

export type N2TrifectaExperimentInputScope = {
  date: string;
  venueCode: string;
};

export type N2TrifectaExperimentInputSourceIndex = {
  date: string;
  venueCode: string;
  indexRelativePath: string;
  indexDigest: string;
  indexGeneratedAt: string;
  passCount: number;
  partialCount: number;
  noDataCount: number;
};

export type N2TrifectaExperimentInputRace = {
  raceIdentity: string;
  date: string;
  venueCode: string;
  raceNo: number;
  checkpointCoverage: typeof CHECKPOINTS;
  sourceLoadDigest: string;
  featureArtifactDigest: string;
  featureArtifactVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION;
  featureArtifactRelativePath: string;
};

export type N2TrifectaPrivateMarketExperimentInputManifest = {
  manifestVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_EXPERIMENT_INPUT_MANIFEST_VERSION;
  evidenceRole: "EXPLORATION_ONLY";
  coveragePolicy: "FULL_TRAJECTORY_ONLY";
  labelPolicy: "NO_OUTCOME_LABELS";
  selectionPolicy: "ALL_PASS_RACES_FROM_EXPLICIT_DAY_INDICES";
  sourceAsOf: string;
  sourceIndices: N2TrifectaExperimentInputSourceIndex[];
  raceCount: number;
  races: N2TrifectaExperimentInputRace[];
  privateResearchOnly: true;
  publicPublishAuthorized: false;
  databaseReadCount: 0;
  databaseWriteCount: 0;
  networkRequestCount: 0;
  rawCaptureEvidenceRead: false;
  rawOddsValuesPublished: false;
  outcomeDataRead: false;
  holdoutDataRead: false;
  validationDataRead: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  automatedBettingAuthorized: false;
  productionApplyAuthorized: false;
  manifestDigest: string;
};

type DayIndexRaceLike = {
  raceNo?: unknown;
  raceIdentity?: unknown;
  status?: unknown;
  availableCheckpoints?: unknown;
  missingCheckpoints?: unknown;
  sourceLoadDigest?: unknown;
  featureArtifactDigest?: unknown;
  featureArtifactVersion?: unknown;
  featureArtifactRelativePath?: unknown;
};

type DayIndexLike = {
  indexVersion?: unknown;
  generatedAt?: unknown;
  date?: unknown;
  venueCode?: unknown;
  raceCount?: unknown;
  status?: unknown;
  passCount?: unknown;
  partialCount?: unknown;
  noDataCount?: unknown;
  totalSnapshotCount?: unknown;
  totalTransitionCount?: unknown;
  races?: unknown;
  privateResearchOnly?: unknown;
  publicPublishAuthorized?: unknown;
  databaseReadCount?: unknown;
  databaseWriteCount?: unknown;
  networkRequestCount?: unknown;
  rawCaptureEvidenceRead?: unknown;
  rawOddsValuesPublished?: unknown;
  currentBuyConnectionAuthorized?: unknown;
  lineConnectionAuthorized?: unknown;
  automatedBettingAuthorized?: unknown;
  productionApplyAuthorized?: unknown;
  indexDigest?: unknown;
};

function resolveInside(rootDir: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("EXPERIMENT_INPUT_PATH_UNSAFE");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("EXPERIMENT_INPUT_PATH_ESCAPES_ROOT");
  }
  return target;
}

function validateScope(scope: N2TrifectaExperimentInputScope): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(scope.date)) throw new Error("EXPERIMENT_INPUT_DATE_INVALID");
  try {
    const canonicalDate = canonicalUtcTimestamp(`${scope.date}T00:00:00.000Z`).slice(0, 10);
    if (canonicalDate !== scope.date) throw new Error("EXPERIMENT_INPUT_DATE_INVALID");
  } catch {
    throw new Error("EXPERIMENT_INPUT_DATE_INVALID");
  }
  if (!/^(0[1-9]|1\d|2[0-4])$/u.test(scope.venueCode)) throw new Error("EXPERIMENT_INPUT_VENUE_INVALID");
}

function dayIndexRelativePath(scope: N2TrifectaExperimentInputScope): string {
  validateScope(scope);
  return `data/private/trifecta-market-features/${scope.date}/${scope.venueCode}/index.json`;
}

function readDayIndex(input: {
  rootDir: string;
  scope: N2TrifectaExperimentInputScope;
}): { source: N2TrifectaExperimentInputSourceIndex; races: N2TrifectaExperimentInputRace[] } {
  validateScope(input.scope);
  const relativePath = dayIndexRelativePath(input.scope);
  const path = resolveInside(input.rootDir, relativePath);
  if (!existsSync(path)) throw new Error(`DAY_INDEX_MISSING:${input.scope.date}:${input.scope.venueCode}`);
  const lst = lstatSync(path);
  if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("DAY_INDEX_FILE_TYPE_INVALID");
  const stat = statSync(path);
  if ((stat.mode & 0o777) !== 0o600) throw new Error("DAY_INDEX_FILE_MODE_INVALID");
  if (stat.size <= 0 || stat.size > MAX_DAY_INDEX_BYTES) throw new Error("DAY_INDEX_FILE_SIZE_INVALID");
  let index: DayIndexLike;
  try {
    index = JSON.parse(readFileSync(path, "utf8")) as DayIndexLike;
  } catch {
    throw new Error("DAY_INDEX_JSON_INVALID");
  }

  if (index.indexVersion !== N2_TRIFECTA_PRIVATE_MARKET_FEATURE_DAY_INDEX_VERSION) throw new Error("DAY_INDEX_VERSION_INVALID");
  if (index.date !== input.scope.date || index.venueCode !== input.scope.venueCode) throw new Error("DAY_INDEX_SCOPE_MISMATCH");
  if (index.raceCount !== 12 || !Array.isArray(index.races) || index.races.length !== 12) throw new Error("DAY_INDEX_RACE_COUNT_INVALID");
  if (typeof index.generatedAt !== "string") throw new Error("DAY_INDEX_GENERATED_AT_INVALID");
  let indexGeneratedAt: string;
  try {
    indexGeneratedAt = canonicalUtcTimestamp(index.generatedAt);
  } catch {
    throw new Error("DAY_INDEX_GENERATED_AT_INVALID");
  }
  if (indexGeneratedAt !== index.generatedAt) throw new Error("DAY_INDEX_GENERATED_AT_INVALID");
  if (typeof index.indexDigest !== "string" || !/^[0-9a-f]{64}$/u.test(index.indexDigest)) throw new Error("DAY_INDEX_DIGEST_INVALID");
  if (index.privateResearchOnly !== true || index.publicPublishAuthorized !== false
    || index.databaseReadCount !== 0 || index.databaseWriteCount !== 0 || index.networkRequestCount !== 0
    || index.rawCaptureEvidenceRead !== false || index.rawOddsValuesPublished !== false
    || index.currentBuyConnectionAuthorized !== false || index.lineConnectionAuthorized !== false
    || index.automatedBettingAuthorized !== false || index.productionApplyAuthorized !== false) {
    throw new Error("DAY_INDEX_PROTECTED_BOUNDARY_INVALID");
  }
  const { indexDigest, ...core } = index as DayIndexLike & { indexDigest: string };
  if (canonicalHash(core) !== indexDigest) throw new Error("DAY_INDEX_DIGEST_MISMATCH");

  const passCount = Number(index.passCount);
  const partialCount = Number(index.partialCount);
  const noDataCount = Number(index.noDataCount);
  if (![passCount, partialCount, noDataCount].every(Number.isSafeInteger)
    || passCount < 0 || partialCount < 0 || noDataCount < 0
    || passCount + partialCount + noDataCount !== 12) {
    throw new Error("DAY_INDEX_STATUS_COUNTS_INVALID");
  }

  const races: N2TrifectaExperimentInputRace[] = [];
  for (const rawRace of index.races as DayIndexRaceLike[]) {
    if (rawRace.status !== "PASS") continue;
    const raceNo = Number(rawRace.raceNo);
    if (!Number.isSafeInteger(raceNo) || raceNo < 1 || raceNo > 12) throw new Error("DAY_INDEX_PASS_RACE_NO_INVALID");
    const expectedRaceIdentity = `${input.scope.date.replaceAll("-", "")}-${input.scope.venueCode}-${String(raceNo).padStart(2, "0")}`;
    if (rawRace.raceIdentity !== expectedRaceIdentity) throw new Error("DAY_INDEX_PASS_RACE_IDENTITY_INVALID");
    const availableCheckpoints = rawRace.availableCheckpoints;
    const missingCheckpoints = rawRace.missingCheckpoints;
    if (!Array.isArray(availableCheckpoints) || !Array.isArray(missingCheckpoints)) {
      throw new Error("DAY_INDEX_PASS_COVERAGE_INVALID");
    }
    if (availableCheckpoints.length !== 4
      || CHECKPOINTS.some((checkpoint, indexValue) => availableCheckpoints[indexValue] !== checkpoint)
      || missingCheckpoints.length !== 0) {
      throw new Error("DAY_INDEX_PASS_COVERAGE_INVALID");
    }
    if (typeof rawRace.sourceLoadDigest !== "string" || !/^[0-9a-f]{64}$/u.test(rawRace.sourceLoadDigest)) {
      throw new Error("DAY_INDEX_PASS_SOURCE_DIGEST_INVALID");
    }
    if (typeof rawRace.featureArtifactDigest !== "string" || !/^[0-9a-f]{64}$/u.test(rawRace.featureArtifactDigest)) {
      throw new Error("DAY_INDEX_PASS_ARTIFACT_DIGEST_INVALID");
    }
    if (rawRace.featureArtifactVersion !== N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION) {
      throw new Error("DAY_INDEX_PASS_ARTIFACT_VERSION_INVALID");
    }
    const expectedRelativePath = `data/private/trifecta-market-features/${input.scope.date}/${input.scope.venueCode}/${String(raceNo).padStart(2, "0")}.json`;
    if (rawRace.featureArtifactRelativePath !== expectedRelativePath) throw new Error("DAY_INDEX_PASS_ARTIFACT_PATH_INVALID");
    races.push({
      raceIdentity: expectedRaceIdentity,
      date: input.scope.date,
      venueCode: input.scope.venueCode,
      raceNo,
      checkpointCoverage: [...CHECKPOINTS],
      sourceLoadDigest: rawRace.sourceLoadDigest,
      featureArtifactDigest: rawRace.featureArtifactDigest,
      featureArtifactVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION,
      featureArtifactRelativePath: expectedRelativePath,
    });
  }
  if (races.length !== passCount) throw new Error("DAY_INDEX_PASS_COUNT_MISMATCH");

  return {
    source: {
      date: input.scope.date,
      venueCode: input.scope.venueCode,
      indexRelativePath: relativePath,
      indexDigest,
      indexGeneratedAt,
      passCount,
      partialCount,
      noDataCount,
    },
    races,
  };
}

export function buildN2TrifectaPrivateMarketExperimentInputManifest(input: {
  rootDir: string;
  scopes: N2TrifectaExperimentInputScope[];
}): N2TrifectaPrivateMarketExperimentInputManifest {
  if (input.scopes.length === 0) throw new Error("EXPERIMENT_INPUT_SCOPE_EMPTY");
  const normalizedScopes = [...input.scopes]
    .map((scope) => ({ date: scope.date, venueCode: scope.venueCode }))
    .sort((left, right) => `${left.date}|${left.venueCode}`.localeCompare(`${right.date}|${right.venueCode}`));
  for (const scope of normalizedScopes) validateScope(scope);
  const keys = normalizedScopes.map((scope) => `${scope.date}|${scope.venueCode}`);
  if (new Set(keys).size !== keys.length) throw new Error("EXPERIMENT_INPUT_SCOPE_DUPLICATE");

  const sources = normalizedScopes.map((scope) => readDayIndex({ rootDir: input.rootDir, scope }));
  const sourceIndices = sources.map((source) => source.source);
  const races = sources.flatMap((source) => source.races)
    .sort((left, right) => left.raceIdentity.localeCompare(right.raceIdentity));
  if (new Set(races.map((race) => race.raceIdentity)).size !== races.length) {
    throw new Error("EXPERIMENT_INPUT_RACE_DUPLICATE");
  }
  const sourceAsOf = sourceIndices
    .map((source) => source.indexGeneratedAt)
    .sort()
    .at(-1)!;
  const core = {
    manifestVersion: N2_TRIFECTA_PRIVATE_MARKET_EXPERIMENT_INPUT_MANIFEST_VERSION,
    evidenceRole: "EXPLORATION_ONLY" as const,
    coveragePolicy: "FULL_TRAJECTORY_ONLY" as const,
    labelPolicy: "NO_OUTCOME_LABELS" as const,
    selectionPolicy: "ALL_PASS_RACES_FROM_EXPLICIT_DAY_INDICES" as const,
    sourceAsOf,
    sourceIndices,
    raceCount: races.length,
    races,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    networkRequestCount: 0 as const,
    rawCaptureEvidenceRead: false as const,
    rawOddsValuesPublished: false as const,
    outcomeDataRead: false as const,
    holdoutDataRead: false as const,
    validationDataRead: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    productionApplyAuthorized: false as const,
  };
  return { ...core, manifestDigest: canonicalHash(core) };
}

export function privateMarketExperimentInputManifestRelativePath(manifestDigest: string): string {
  if (!/^[0-9a-f]{64}$/u.test(manifestDigest)) throw new Error("EXPERIMENT_INPUT_MANIFEST_DIGEST_INVALID");
  return `data/private/trifecta-market-experiments/manifests/${manifestDigest}.json`;
}

function verifyExistingManifest(path: string, expected: N2TrifectaPrivateMarketExperimentInputManifest): boolean {
  const lst = lstatSync(path);
  if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("EXPERIMENT_INPUT_MANIFEST_FILE_TYPE_INVALID");
  const stat = statSync(path);
  if ((stat.mode & 0o777) !== 0o600) throw new Error("EXPERIMENT_INPUT_MANIFEST_FILE_MODE_INVALID");
  if (stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) throw new Error("EXPERIMENT_INPUT_MANIFEST_FILE_SIZE_INVALID");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("EXPERIMENT_INPUT_MANIFEST_JSON_INVALID");
  }
  return canonicalHash(value) === canonicalHash(expected);
}

export function writeN2TrifectaPrivateMarketExperimentInputManifest(input: {
  rootDir: string;
  manifest: N2TrifectaPrivateMarketExperimentInputManifest;
}): { relativePath: string; created: boolean; manifestDigest: string; fileMode: 0o600 } {
  const relativePath = privateMarketExperimentInputManifestRelativePath(input.manifest.manifestDigest);
  const path = resolveInside(input.rootDir, relativePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const parent = lstatSync(dirname(path));
  if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error("EXPERIMENT_INPUT_MANIFEST_PARENT_INVALID");
  if (existsSync(path)) {
    if (!verifyExistingManifest(path, input.manifest)) throw new Error("EXPERIMENT_INPUT_MANIFEST_COLLISION");
    return { relativePath, created: false, manifestDigest: input.manifest.manifestDigest, fileMode: 0o600 };
  }
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(input.manifest, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error("EXPERIMENT_INPUT_MANIFEST_FINAL_MODE_INVALID");
  return { relativePath, created: true, manifestDigest: input.manifest.manifestDigest, fileMode: 0o600 };
}
