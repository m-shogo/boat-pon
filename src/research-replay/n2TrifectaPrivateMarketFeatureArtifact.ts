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
import type { N2TrifectaMarketRaceFeatureSequence } from "./n2TrifectaMarketFeatureEngineering";
import {
  N2_TRIFECTA_PRIVATE_MARKET_FEATURE_LOADER_VERSION,
  type N2TrifectaPrivateMarketFeatureLoadReport,
} from "./n2TrifectaPrivateMarketFeatureLoader";

export const N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION =
  "n2-trifecta-private-market-feature-artifact-v2" as const;

const MAX_EXISTING_ARTIFACT_BYTES = 20_000_000;

export type N2TrifectaPrivateMarketFeatureArtifact = {
  featureArtifactVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION;
  generatedAt: string;
  sourceLoadDigest: string;
  raceIdentity: string;
  status: "PASS" | "PARTIAL";
  sequence: N2TrifectaMarketRaceFeatureSequence;
  privateResearchOnly: true;
  publicPublishAuthorized: false;
  databaseWriteAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  automatedBettingAuthorized: false;
  artifactDigest: string;
};

export type N2TrifectaPrivateMarketFeatureArtifactWriteResult = {
  relativePath: string;
  changed: boolean;
  replacedExisting: boolean;
  sourceLoadDigest: string;
  artifactDigest: string;
  fileMode: 0o600;
};

type ExistingArtifactLike = {
  featureArtifactVersion?: unknown;
  generatedAt?: unknown;
  sourceLoadDigest?: unknown;
  raceIdentity?: unknown;
  status?: unknown;
  sequence?: unknown;
  privateResearchOnly?: unknown;
  publicPublishAuthorized?: unknown;
  databaseWriteAuthorized?: unknown;
  currentBuyConnectionAuthorized?: unknown;
  lineConnectionAuthorized?: unknown;
  automatedBettingAuthorized?: unknown;
  artifactDigest?: unknown;
};

type ExistingArtifactRead = {
  value: ExistingArtifactLike;
  mode0600: boolean;
};

function resolveInside(rootDir: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("PRIVATE_FEATURE_PATH_UNSAFE");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("PRIVATE_FEATURE_PATH_ESCAPES_ROOT");
  }
  return target;
}

function canonicalRaceDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  try {
    return canonicalUtcTimestamp(`${date}T00:00:00.000Z`).slice(0, 10) === date ? date : null;
  } catch {
    return null;
  }
}

function validateReport(report: N2TrifectaPrivateMarketFeatureLoadReport): asserts report is
  N2TrifectaPrivateMarketFeatureLoadReport & { status: "PASS" | "PARTIAL" } {
  if (report.loaderVersion !== N2_TRIFECTA_PRIVATE_MARKET_FEATURE_LOADER_VERSION) {
    throw new Error("PRIVATE_FEATURE_ARTIFACT_SOURCE_VERSION_INVALID");
  }
  if (report.status !== "PASS" && report.status !== "PARTIAL") {
    throw new Error("PRIVATE_FEATURE_ARTIFACT_REQUIRES_PASS_OR_PARTIAL");
  }
  if (!/^\d{8}-(0[1-9]|1\d|2[0-4])-\d{2}$/u.test(report.raceIdentity)) {
    throw new Error("PRIVATE_FEATURE_ARTIFACT_RACE_IDENTITY_INVALID");
  }
  if (canonicalRaceDate(report.date) == null
    || !/^(0[1-9]|1\d|2[0-4])$/u.test(report.venueCode)
    || !Number.isSafeInteger(report.raceNo) || report.raceNo < 1 || report.raceNo > 12) {
    throw new Error("PRIVATE_FEATURE_ARTIFACT_RACE_FIELDS_INVALID");
  }
  const expectedRaceIdentity = `${report.date.replaceAll("-", "")}-${report.venueCode}-${String(report.raceNo).padStart(2, "0")}`;
  if (report.raceIdentity !== expectedRaceIdentity) {
    throw new Error("PRIVATE_FEATURE_ARTIFACT_RACE_LINEAGE_MISMATCH");
  }
  if (report.outputDigest.length !== 64 || !/^[0-9a-f]+$/u.test(report.outputDigest)) {
    throw new Error("PRIVATE_FEATURE_ARTIFACT_SOURCE_DIGEST_INVALID");
  }
  if (report.networkRequestCount !== 0 || report.databaseReadCount !== 0 || report.databaseWriteCount !== 0) {
    throw new Error("PRIVATE_FEATURE_ARTIFACT_SOURCE_IO_BOUNDARY_INVALID");
  }
  if (report.rawValuesPublished !== false || report.privateResearchOnly !== true
    || report.publicPublishAuthorized !== false) {
    throw new Error("PRIVATE_FEATURE_ARTIFACT_SOURCE_PUBLIC_BOUNDARY_INVALID");
  }
}

export function privateMarketFeatureArtifactRelativePath(input: {
  date: string;
  venueCode: string;
  raceNo: number;
}): string {
  if (canonicalRaceDate(input.date) == null) throw new Error("PRIVATE_FEATURE_DATE_INVALID");
  if (!/^(0[1-9]|1\d|2[0-4])$/u.test(input.venueCode)) throw new Error("PRIVATE_FEATURE_VENUE_INVALID");
  if (!Number.isSafeInteger(input.raceNo) || input.raceNo < 1 || input.raceNo > 12) {
    throw new Error("PRIVATE_FEATURE_RACE_NO_INVALID");
  }
  return [
    "data",
    "private",
    "trifecta-market-features",
    input.date,
    input.venueCode,
    `${String(input.raceNo).padStart(2, "0")}.json`,
  ].join("/");
}

export function buildN2TrifectaPrivateMarketFeatureArtifact(input: {
  report: N2TrifectaPrivateMarketFeatureLoadReport;
  generatedAt: string;
}): N2TrifectaPrivateMarketFeatureArtifact {
  validateReport(input.report);
  let generatedAt: string;
  try {
    generatedAt = canonicalUtcTimestamp(input.generatedAt);
  } catch {
    throw new Error("PRIVATE_FEATURE_GENERATED_AT_INVALID");
  }
  const core = {
    featureArtifactVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION,
    generatedAt,
    sourceLoadDigest: input.report.outputDigest,
    raceIdentity: input.report.raceIdentity,
    status: input.report.status,
    sequence: input.report.sequence,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    automatedBettingAuthorized: false as const,
  };
  return { ...core, artifactDigest: canonicalHash(core) };
}

function readExistingArtifact(path: string): ExistingArtifactRead | null {
  if (!existsSync(path)) return null;
  const lst = lstatSync(path);
  if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("PRIVATE_FEATURE_EXISTING_FILE_TYPE_INVALID");
  const stat = statSync(path);
  if (stat.size <= 0 || stat.size > MAX_EXISTING_ARTIFACT_BYTES) {
    throw new Error("PRIVATE_FEATURE_EXISTING_SIZE_INVALID");
  }
  try {
    return {
      value: JSON.parse(readFileSync(path, "utf8")) as ExistingArtifactLike,
      mode0600: (stat.mode & 0o777) === 0o600,
    };
  } catch {
    throw new Error("PRIVATE_FEATURE_EXISTING_JSON_INVALID");
  }
}

function reusableArtifactDigest(input: {
  existing: ExistingArtifactRead;
  report: N2TrifectaPrivateMarketFeatureLoadReport & { status: "PASS" | "PARTIAL" };
}): string | null {
  const value = input.existing.value;
  if (!input.existing.mode0600) return null;
  if (value.featureArtifactVersion !== N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION) return null;
  if (value.sourceLoadDigest !== input.report.outputDigest) return null;
  if (value.raceIdentity !== input.report.raceIdentity || value.status !== input.report.status) return null;
  if (typeof value.generatedAt !== "string") return null;
  let generatedAt: string;
  try {
    generatedAt = canonicalUtcTimestamp(value.generatedAt);
  } catch {
    return null;
  }
  if (generatedAt !== value.generatedAt) return null;
  if (typeof value.sequence !== "object" || value.sequence == null) return null;
  if (canonicalHash(value.sequence) !== canonicalHash(input.report.sequence)) return null;
  if (value.privateResearchOnly !== true || value.publicPublishAuthorized !== false
    || value.databaseWriteAuthorized !== false || value.currentBuyConnectionAuthorized !== false
    || value.lineConnectionAuthorized !== false || value.automatedBettingAuthorized !== false) {
    return null;
  }
  if (typeof value.artifactDigest !== "string" || !/^[0-9a-f]{64}$/u.test(value.artifactDigest)) return null;
  const core = {
    featureArtifactVersion: value.featureArtifactVersion,
    generatedAt,
    sourceLoadDigest: value.sourceLoadDigest,
    raceIdentity: value.raceIdentity,
    status: value.status,
    sequence: value.sequence,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    automatedBettingAuthorized: false as const,
  };
  return canonicalHash(core) === value.artifactDigest ? value.artifactDigest : null;
}

function atomicMode0600Replace(path: string, content: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error("PRIVATE_FEATURE_PARENT_DIRECTORY_INVALID");
  }
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    if (fd != null) closeSync(fd);
    rmSync(temporary, { force: true });
  }
  const finalStat = statSync(path);
  if (!finalStat.isFile() || (finalStat.mode & 0o777) !== 0o600) {
    throw new Error("PRIVATE_FEATURE_FINAL_MODE_INVALID");
  }
}

export function writeN2TrifectaPrivateMarketFeatureArtifact(input: {
  rootDir: string;
  report: N2TrifectaPrivateMarketFeatureLoadReport;
  generatedAt?: string;
}): N2TrifectaPrivateMarketFeatureArtifactWriteResult {
  validateReport(input.report);
  const relativePath = privateMarketFeatureArtifactRelativePath({
    date: input.report.date,
    venueCode: input.report.venueCode,
    raceNo: input.report.raceNo,
  });
  const path = resolveInside(input.rootDir, relativePath);
  const existing = readExistingArtifact(path);
  const reusableDigest = existing == null ? null : reusableArtifactDigest({
    existing,
    report: input.report,
  });
  if (reusableDigest != null) {
    return {
      relativePath,
      changed: false,
      replacedExisting: true,
      sourceLoadDigest: input.report.outputDigest,
      artifactDigest: reusableDigest,
      fileMode: 0o600,
    };
  }

  const artifact = buildN2TrifectaPrivateMarketFeatureArtifact({
    report: input.report,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  });
  atomicMode0600Replace(path, `${JSON.stringify(artifact, null, 2)}\n`);
  return {
    relativePath,
    changed: true,
    replacedExisting: existing != null,
    sourceLoadDigest: artifact.sourceLoadDigest,
    artifactDigest: artifact.artifactDigest,
    fileMode: 0o600,
  };
}