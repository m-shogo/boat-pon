import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { N2_TRIFECTA_MARKET_FEATURE_VERSION } from "./n2TrifectaMarketFeatureEngineering";
import { N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION } from
  "./n2TrifectaPrivateMarketFeatureArtifact";

export const N2_TRIFECTA_PRIVATE_MARKET_FEATURE_DAY_INDEX_VERSION =
  "n2-trifecta-private-market-feature-day-index-v1" as const;

const MAX_FEATURE_ARTIFACT_BYTES = 20_000_000;
const CHECKPOINTS = ["T-30", "T-20", "T-10", "T-5"] as const;
type CheckpointLabel = typeof CHECKPOINTS[number];

export type N2TrifectaPrivateMarketFeatureDayIndexRace = {
  raceNo: number;
  raceIdentity: string;
  status: "PASS" | "PARTIAL" | "NO_DATA";
  availableCheckpoints: CheckpointLabel[];
  missingCheckpoints: CheckpointLabel[];
  snapshotCount: number;
  transitionCount: number;
  sourceLoadDigest: string | null;
  featureArtifactDigest: string | null;
  featureArtifactVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION | null;
  featureArtifactRelativePath: string | null;
};

export type N2TrifectaPrivateMarketFeatureDayIndex = {
  indexVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_FEATURE_DAY_INDEX_VERSION;
  generatedAt: string;
  date: string;
  venueCode: string;
  raceCount: 12;
  status: "PASS" | "PARTIAL" | "NO_DATA";
  passCount: number;
  partialCount: number;
  noDataCount: number;
  totalSnapshotCount: number;
  totalTransitionCount: number;
  races: N2TrifectaPrivateMarketFeatureDayIndexRace[];
  privateResearchOnly: true;
  publicPublishAuthorized: false;
  databaseReadCount: 0;
  databaseWriteCount: 0;
  networkRequestCount: 0;
  rawCaptureEvidenceRead: false;
  rawOddsValuesPublished: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  automatedBettingAuthorized: false;
  productionApplyAuthorized: false;
  indexDigest: string;
};

type FeatureArtifactLike = {
  featureArtifactVersion?: unknown;
  generatedAt?: unknown;
  sourceLoadDigest?: unknown;
  raceIdentity?: unknown;
  status?: unknown;
  sequence?: {
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
  } | null;
  privateResearchOnly?: unknown;
  publicPublishAuthorized?: unknown;
  databaseWriteAuthorized?: unknown;
  currentBuyConnectionAuthorized?: unknown;
  lineConnectionAuthorized?: unknown;
  automatedBettingAuthorized?: unknown;
  artifactDigest?: unknown;
};

function resolveInside(rootDir: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("PRIVATE_FEATURE_DAY_INDEX_PATH_UNSAFE");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("PRIVATE_FEATURE_DAY_INDEX_PATH_ESCAPES_ROOT");
  }
  return target;
}

function validateScope(date: string, venueCode: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error("PRIVATE_FEATURE_DAY_INDEX_DATE_INVALID");
  let canonicalDate: string;
  try {
    canonicalDate = canonicalUtcTimestamp(`${date}T00:00:00.000Z`).slice(0, 10);
  } catch {
    throw new Error("PRIVATE_FEATURE_DAY_INDEX_DATE_INVALID");
  }
  if (canonicalDate !== date) throw new Error("PRIVATE_FEATURE_DAY_INDEX_DATE_INVALID");
  if (!/^(0[1-9]|1\d|2[0-4])$/u.test(venueCode)) throw new Error("PRIVATE_FEATURE_DAY_INDEX_VENUE_INVALID");
}

function featureRelativePath(date: string, venueCode: string, raceNo: number): string {
  return `data/private/trifecta-market-features/${date}/${venueCode}/${String(raceNo).padStart(2, "0")}.json`;
}

export function privateMarketFeatureDayIndexRelativePath(input: {
  date: string;
  venueCode: string;
}): string {
  validateScope(input.date, input.venueCode);
  return `data/private/trifecta-market-features/${input.date}/${input.venueCode}/index.json`;
}

function normalizeCheckpointArray(value: unknown, label: string): CheckpointLabel[] {
  if (!Array.isArray(value)) throw new Error(`${label}_INVALID`);
  const output: CheckpointLabel[] = [];
  for (const item of value) {
    if (!CHECKPOINTS.includes(item as CheckpointLabel)) throw new Error(`${label}_INVALID`);
    if (!output.includes(item as CheckpointLabel)) output.push(item as CheckpointLabel);
  }
  return output;
}

function validateArtifactCore(input: {
  artifact: FeatureArtifactLike;
  date: string;
  venueCode: string;
  raceNo: number;
}): N2TrifectaPrivateMarketFeatureDayIndexRace {
  const artifact = input.artifact;
  const expectedRaceIdentity = `${input.date.replaceAll("-", "")}-${input.venueCode}-${String(input.raceNo).padStart(2, "0")}`;
  if (artifact.featureArtifactVersion !== N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION) {
    throw new Error(`R${input.raceNo}_FEATURE_ARTIFACT_VERSION_INVALID`);
  }
  if (artifact.raceIdentity !== expectedRaceIdentity) throw new Error(`R${input.raceNo}_RACE_IDENTITY_INVALID`);
  if (artifact.status !== "PASS" && artifact.status !== "PARTIAL") throw new Error(`R${input.raceNo}_STATUS_INVALID`);
  if (typeof artifact.generatedAt !== "string") throw new Error(`R${input.raceNo}_GENERATED_AT_INVALID`);
  let artifactGeneratedAt: string;
  try {
    artifactGeneratedAt = canonicalUtcTimestamp(artifact.generatedAt);
  } catch {
    throw new Error(`R${input.raceNo}_GENERATED_AT_INVALID`);
  }
  if (artifactGeneratedAt !== artifact.generatedAt) throw new Error(`R${input.raceNo}_GENERATED_AT_INVALID`);
  if (typeof artifact.sourceLoadDigest !== "string" || !/^[0-9a-f]{64}$/u.test(artifact.sourceLoadDigest)) {
    throw new Error(`R${input.raceNo}_SOURCE_DIGEST_INVALID`);
  }
  if (typeof artifact.artifactDigest !== "string" || !/^[0-9a-f]{64}$/u.test(artifact.artifactDigest)) {
    throw new Error(`R${input.raceNo}_ARTIFACT_DIGEST_INVALID`);
  }
  if (artifact.privateResearchOnly !== true || artifact.publicPublishAuthorized !== false
    || artifact.databaseWriteAuthorized !== false || artifact.currentBuyConnectionAuthorized !== false
    || artifact.lineConnectionAuthorized !== false || artifact.automatedBettingAuthorized !== false) {
    throw new Error(`R${input.raceNo}_PROTECTED_BOUNDARY_INVALID`);
  }
  if (typeof artifact.sequence !== "object" || artifact.sequence == null) {
    throw new Error(`R${input.raceNo}_SEQUENCE_INVALID`);
  }
  if (artifact.sequence.featureVersion !== N2_TRIFECTA_MARKET_FEATURE_VERSION) {
    throw new Error(`R${input.raceNo}_SEQUENCE_VERSION_INVALID`);
  }
  if (artifact.sequence.raceIdentity !== expectedRaceIdentity) {
    throw new Error(`R${input.raceNo}_SEQUENCE_RACE_IDENTITY_INVALID`);
  }
  if (artifact.sequence.status !== artifact.status) {
    throw new Error(`R${input.raceNo}_SEQUENCE_STATUS_INVALID`);
  }
  if (!Array.isArray(artifact.sequence.blockers)
    || artifact.sequence.blockers.some((blocker) => typeof blocker !== "string")) {
    throw new Error(`R${input.raceNo}_SEQUENCE_BLOCKERS_INVALID`);
  }
  if (artifact.sequence.privateResearchOnly !== true
    || artifact.sequence.publicPublishAuthorized !== false
    || artifact.sequence.databaseWriteAuthorized !== false) {
    throw new Error(`R${input.raceNo}_SEQUENCE_AUTHORITY_INVALID`);
  }
  if (typeof artifact.sequence.outputDigest !== "string" || !/^[0-9a-f]{64}$/u.test(artifact.sequence.outputDigest)) {
    throw new Error(`R${input.raceNo}_SEQUENCE_DIGEST_INVALID`);
  }
  const { outputDigest: sequenceDigest, ...sequenceCore } = artifact.sequence;
  if (canonicalHash(sequenceCore) !== sequenceDigest) {
    throw new Error(`R${input.raceNo}_SEQUENCE_DIGEST_MISMATCH`);
  }
  const availableCheckpoints = normalizeCheckpointArray(
    artifact.sequence.availableCheckpoints,
    `R${input.raceNo}_AVAILABLE_CHECKPOINTS`,
  );
  const missingCheckpoints = normalizeCheckpointArray(
    artifact.sequence.missingCheckpoints,
    `R${input.raceNo}_MISSING_CHECKPOINTS`,
  );
  if (availableCheckpoints.some((checkpoint) => missingCheckpoints.includes(checkpoint))) {
    throw new Error(`R${input.raceNo}_CHECKPOINT_OVERLAP_INVALID`);
  }
  if (new Set([...availableCheckpoints, ...missingCheckpoints]).size !== CHECKPOINTS.length) {
    throw new Error(`R${input.raceNo}_CHECKPOINT_COVERAGE_INVALID`);
  }
  if (!Array.isArray(artifact.sequence.snapshots) || !Array.isArray(artifact.sequence.transitions)) {
    throw new Error(`R${input.raceNo}_SEQUENCE_COUNTS_INVALID`);
  }
  const snapshotCount = artifact.sequence.snapshots.length;
  const transitionCount = artifact.sequence.transitions.length;
  if (snapshotCount !== availableCheckpoints.length) throw new Error(`R${input.raceNo}_SNAPSHOT_COUNT_INVALID`);
  if (transitionCount !== Math.max(0, snapshotCount - 1)) throw new Error(`R${input.raceNo}_TRANSITION_COUNT_INVALID`);
  if (artifact.status === "PASS" && (availableCheckpoints.length !== 4 || missingCheckpoints.length !== 0)) {
    throw new Error(`R${input.raceNo}_PASS_COVERAGE_INVALID`);
  }
  if (artifact.status === "PARTIAL" && (availableCheckpoints.length < 1 || availableCheckpoints.length >= 4)) {
    throw new Error(`R${input.raceNo}_PARTIAL_COVERAGE_INVALID`);
  }

  const core = {
    featureArtifactVersion: artifact.featureArtifactVersion,
    generatedAt: artifactGeneratedAt,
    sourceLoadDigest: artifact.sourceLoadDigest,
    raceIdentity: artifact.raceIdentity,
    status: artifact.status,
    sequence: artifact.sequence,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    automatedBettingAuthorized: false as const,
  };
  if (canonicalHash(core) !== artifact.artifactDigest) {
    throw new Error(`R${input.raceNo}_ARTIFACT_DIGEST_MISMATCH`);
  }

  return {
    raceNo: input.raceNo,
    raceIdentity: expectedRaceIdentity,
    status: artifact.status,
    availableCheckpoints,
    missingCheckpoints,
    snapshotCount,
    transitionCount,
    sourceLoadDigest: artifact.sourceLoadDigest,
    featureArtifactDigest: artifact.artifactDigest,
    featureArtifactVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION,
    featureArtifactRelativePath: featureRelativePath(input.date, input.venueCode, input.raceNo),
  };
}

function readRace(input: {
  rootDir: string;
  date: string;
  venueCode: string;
  raceNo: number;
}): N2TrifectaPrivateMarketFeatureDayIndexRace {
  const relativePath = featureRelativePath(input.date, input.venueCode, input.raceNo);
  const path = resolveInside(input.rootDir, relativePath);
  const expectedRaceIdentity = `${input.date.replaceAll("-", "")}-${input.venueCode}-${String(input.raceNo).padStart(2, "0")}`;
  if (!existsSync(path)) {
    return {
      raceNo: input.raceNo,
      raceIdentity: expectedRaceIdentity,
      status: "NO_DATA",
      availableCheckpoints: [],
      missingCheckpoints: [...CHECKPOINTS],
      snapshotCount: 0,
      transitionCount: 0,
      sourceLoadDigest: null,
      featureArtifactDigest: null,
      featureArtifactVersion: null,
      featureArtifactRelativePath: null,
    };
  }
  const lst = lstatSync(path);
  if (lst.isSymbolicLink() || !lst.isFile()) throw new Error(`R${input.raceNo}_FEATURE_FILE_TYPE_INVALID`);
  const stat = statSync(path);
  if ((stat.mode & 0o777) !== 0o600) throw new Error(`R${input.raceNo}_FEATURE_FILE_MODE_INVALID`);
  if (stat.size <= 0 || stat.size > MAX_FEATURE_ARTIFACT_BYTES) throw new Error(`R${input.raceNo}_FEATURE_FILE_SIZE_INVALID`);
  let artifact: FeatureArtifactLike;
  try {
    artifact = JSON.parse(readFileSync(path, "utf8")) as FeatureArtifactLike;
  } catch {
    throw new Error(`R${input.raceNo}_FEATURE_JSON_INVALID`);
  }
  return validateArtifactCore({ ...input, artifact });
}

export function buildN2TrifectaPrivateMarketFeatureDayIndex(input: {
  rootDir: string;
  date: string;
  venueCode: string;
  generatedAt?: string;
}): N2TrifectaPrivateMarketFeatureDayIndex {
  validateScope(input.date, input.venueCode);
  let generatedAt: string;
  try {
    generatedAt = canonicalUtcTimestamp(input.generatedAt ?? new Date().toISOString());
  } catch {
    throw new Error("PRIVATE_FEATURE_DAY_INDEX_GENERATED_AT_INVALID");
  }
  const races = Array.from({ length: 12 }, (_, index) => readRace({
    rootDir: input.rootDir,
    date: input.date,
    venueCode: input.venueCode,
    raceNo: index + 1,
  }));
  const passCount = races.filter((race) => race.status === "PASS").length;
  const partialCount = races.filter((race) => race.status === "PARTIAL").length;
  const noDataCount = races.filter((race) => race.status === "NO_DATA").length;
  const status = passCount === 12
    ? "PASS" as const
    : noDataCount === 12
      ? "NO_DATA" as const
      : "PARTIAL" as const;
  const core = {
    indexVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_DAY_INDEX_VERSION,
    generatedAt,
    date: input.date,
    venueCode: input.venueCode,
    raceCount: 12 as const,
    status,
    passCount,
    partialCount,
    noDataCount,
    totalSnapshotCount: races.reduce((sum, race) => sum + race.snapshotCount, 0),
    totalTransitionCount: races.reduce((sum, race) => sum + race.transitionCount, 0),
    races,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    networkRequestCount: 0 as const,
    rawCaptureEvidenceRead: false as const,
    rawOddsValuesPublished: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    productionApplyAuthorized: false as const,
  };
  return { ...core, indexDigest: canonicalHash(core) };
}

function atomicMode0600Replace(path: string, content: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error("PRIVATE_FEATURE_DAY_INDEX_PARENT_INVALID");
  }
  if (existsSync(path)) {
    const current = lstatSync(path);
    if (current.isSymbolicLink() || !current.isFile()) throw new Error("PRIVATE_FEATURE_DAY_INDEX_TARGET_INVALID");
  }
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temp, path);
    chmodSync(path, 0o600);
  } finally {
    if (fd != null) closeSync(fd);
    rmSync(temp, { force: true });
  }
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error("PRIVATE_FEATURE_DAY_INDEX_FINAL_MODE_INVALID");
}

export function writeN2TrifectaPrivateMarketFeatureDayIndex(input: {
  rootDir: string;
  index: N2TrifectaPrivateMarketFeatureDayIndex;
}): { relativePath: string; changed: boolean; indexDigest: string; fileMode: 0o600 } {
  const relativePath = privateMarketFeatureDayIndexRelativePath(input.index);
  const path = resolveInside(input.rootDir, relativePath);
  if (existsSync(path)) {
    const lst = lstatSync(path);
    if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("PRIVATE_FEATURE_DAY_INDEX_TARGET_INVALID");
    const stat = statSync(path);
    if (stat.size > 0 && stat.size <= MAX_FEATURE_ARTIFACT_BYTES && (stat.mode & 0o777) === 0o600) {
      try {
        const current = JSON.parse(readFileSync(path, "utf8")) as N2TrifectaPrivateMarketFeatureDayIndex;
        if (typeof current.indexDigest === "string" && /^[0-9a-f]{64}$/u.test(current.indexDigest)
          && typeof current.generatedAt === "string") {
          let currentGeneratedAt: string;
          try {
            currentGeneratedAt = canonicalUtcTimestamp(current.generatedAt);
          } catch {
            currentGeneratedAt = "";
          }
          if (currentGeneratedAt === current.generatedAt) {
            const { indexDigest: currentDigest, ...currentCore } = current;
            if (canonicalHash(currentCore) === currentDigest) {
              if (currentDigest === input.index.indexDigest) {
                return { relativePath, changed: false, indexDigest: currentDigest, fileMode: 0o600 };
              }
              const { generatedAt: _currentGeneratedAt, ...currentSemanticCore } = currentCore;
              const {
                indexDigest: _nextDigest,
                generatedAt: _nextGeneratedAt,
                ...nextSemanticCore
              } = input.index;
              if (canonicalHash(currentSemanticCore) === canonicalHash(nextSemanticCore)) {
                return { relativePath, changed: false, indexDigest: currentDigest, fileMode: 0o600 };
              }
            }
          }
        }
      } catch {
        // Derived index is rebuildable from verified feature artifacts.
      }
    }
  }
  atomicMode0600Replace(path, `${JSON.stringify(input.index, null, 2)}\n`);
  return { relativePath, changed: true, indexDigest: input.index.indexDigest, fileMode: 0o600 };
}
