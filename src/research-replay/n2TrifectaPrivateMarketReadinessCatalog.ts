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
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import { canonicalHash } from "./canonical";
import {
  N2_TRIFECTA_PRIVATE_MARKET_DAILY_READINESS_VERSION,
  type N2TrifectaPrivateMarketDailyReadiness,
  type N2TrifectaPrivateMarketDailyReadinessStatus,
} from "./n2TrifectaPrivateMarketDailyReadiness";

export const N2_TRIFECTA_PRIVATE_MARKET_READINESS_CATALOG_VERSION =
  "n2-trifecta-private-market-readiness-catalog-v1" as const;

const READINESS_ROOT_RELATIVE = "data/private/trifecta-market-experiments/readiness";
const CATALOG_RELATIVE_PATH = `${READINESS_ROOT_RELATIVE}/catalog.json`;
const MAX_READINESS_ARTIFACT_BYTES = 2_000_000;
const MAX_CATALOG_BYTES = 10_000_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const VENUE_RE = /^(0[1-9]|1\d|2[0-4])$/u;
const DIGEST_RE = /^[0-9a-f]{64}$/u;
const RACE_IDENTITY_RE = /^\d{8}-(0[1-9]|1\d|2[0-4])-\d{2}$/u;

export type N2TrifectaPrivateMarketReadinessCatalogEntry = {
  date: string;
  venueCode: string;
  latestCheckedAt: string;
  readinessStatus: N2TrifectaPrivateMarketDailyReadinessStatus;
  readinessDigest: string;
  sourceDayIndexDigest: string;
  sourceDayIndexStatus: "PASS" | "PARTIAL" | "NO_DATA";
  completeRaceCount: number;
  partialRaceCount: number;
  noDataRaceCount: number;
  cohortCandidateRaceCount: number;
  checkpointCoverageNumerator: number;
  checkpointCoverageDenominator: 48;
  checkpointCoverageRatio: number;
  heartbeatStatus: string;
  heartbeatSignificantGapCount: number;
  heartbeatAffectedCheckpointCount: number;
  heartbeatCurrentGapOverThreshold: boolean;
  heartbeatPlanStatus: string;
  scopeArtifactCount: number;
};

export type N2TrifectaPrivateMarketReadinessCatalog = {
  catalogVersion: typeof N2_TRIFECTA_PRIVATE_MARKET_READINESS_CATALOG_VERSION;
  evidenceRole: "EXPLORATION_READINESS_CATALOG_ONLY";
  generatedAt: string;
  sourceArtifactCount: number;
  entryCount: number;
  earliestDate: string | null;
  latestDate: string | null;
  fullCoverageScopeCount: number;
  entries: N2TrifectaPrivateMarketReadinessCatalogEntry[];
  privateResearchOnly: true;
  automaticFreezeAuthorized: false;
  outcomeDataRead: false;
  validationDataRead: false;
  holdoutDataRead: false;
  rawCaptureEvidenceRead: false;
  rawOddsValuesRead: false;
  rawOddsValuesPublished: false;
  networkRequestCount: 0;
  databaseReadCount: 0;
  databaseWriteCount: 0;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  automatedBettingAuthorized: false;
  publicPublishAuthorized: false;
  productionApplyAuthorized: false;
  catalogDigest: string;
};

type VerifiedReadinessArtifact = {
  artifact: N2TrifectaPrivateMarketDailyReadiness;
  date: string;
  venueCode: string;
  outputDigest: string;
};

function parseInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jstDate(value: string): string | null {
  const parsed = parseInstant(value);
  if (parsed == null) return null;
  return new Date(parsed + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function resolveInside(rootDir: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("READINESS_CATALOG_PATH_UNSAFE");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("READINESS_CATALOG_PATH_ESCAPES_ROOT");
  }
  return target;
}

function requirePrivateDirectory(path: string, code: string): void {
  const lst = lstatSync(path);
  if (lst.isSymbolicLink() || !lst.isDirectory()) throw new Error(code);
}

function readJsonObject(path: string, maxBytes: number, codePrefix: string): Record<string, unknown> {
  const lst = lstatSync(path);
  if (lst.isSymbolicLink() || !lst.isFile()) throw new Error(`${codePrefix}_FILE_TYPE_INVALID`);
  const stat = statSync(path);
  if ((stat.mode & 0o777) !== 0o600) throw new Error(`${codePrefix}_FILE_MODE_INVALID`);
  if (stat.size <= 0 || stat.size > maxBytes) throw new Error(`${codePrefix}_FILE_SIZE_INVALID`);
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof value !== "object" || value == null || Array.isArray(value)) {
      throw new Error("not object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`${codePrefix}_JSON_INVALID`);
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateReadinessArtifact(input: {
  value: Record<string, unknown>;
  expectedDate: string;
  expectedVenueCode: string;
  expectedDigest: string;
}): N2TrifectaPrivateMarketDailyReadiness {
  const value = input.value;
  if (value.readinessVersion !== N2_TRIFECTA_PRIVATE_MARKET_DAILY_READINESS_VERSION) {
    throw new Error("READINESS_CATALOG_ARTIFACT_VERSION_INVALID");
  }
  if (value.evidenceRole !== "EXPLORATION_READINESS_ONLY") {
    throw new Error("READINESS_CATALOG_ARTIFACT_ROLE_INVALID");
  }
  if (value.date !== input.expectedDate || value.venueCode !== input.expectedVenueCode) {
    throw new Error("READINESS_CATALOG_ARTIFACT_SCOPE_MISMATCH");
  }
  if (value.outputDigest !== input.expectedDigest || !DIGEST_RE.test(input.expectedDigest)) {
    throw new Error("READINESS_CATALOG_ARTIFACT_DIGEST_PATH_MISMATCH");
  }
  const { outputDigest, ...core } = value;
  if (canonicalHash(core) !== outputDigest) {
    throw new Error("READINESS_CATALOG_ARTIFACT_DIGEST_MISMATCH");
  }
  if (typeof value.checkedAt !== "string" || parseInstant(value.checkedAt) == null
    || jstDate(value.checkedAt) !== input.expectedDate) {
    throw new Error("READINESS_CATALOG_ARTIFACT_CHECKED_AT_INVALID");
  }
  if (!(["PASS", "DEGRADED", "NO_DATA", "BLOCKED"] as unknown[]).includes(value.status)) {
    throw new Error("READINESS_CATALOG_ARTIFACT_STATUS_INVALID");
  }
  if (!(["PASS", "PARTIAL", "NO_DATA"] as unknown[]).includes(value.sourceDayIndexStatus)
    || typeof value.sourceDayIndexDigest !== "string" || !DIGEST_RE.test(value.sourceDayIndexDigest)) {
    throw new Error("READINESS_CATALOG_ARTIFACT_DAY_INDEX_INVALID");
  }
  if (!isNonNegativeInteger(value.completeRaceCount)
    || !isNonNegativeInteger(value.partialRaceCount)
    || !isNonNegativeInteger(value.noDataRaceCount)
    || value.completeRaceCount + value.partialRaceCount + value.noDataRaceCount !== 12) {
    throw new Error("READINESS_CATALOG_ARTIFACT_RACE_COUNTS_INVALID");
  }
  if (!isNonNegativeInteger(value.cohortCandidateRaceCount)
    || value.cohortCandidateRaceCount !== value.completeRaceCount
    || !Array.isArray(value.cohortCandidateRaceIdentities)
    || value.cohortCandidateRaceIdentities.length !== value.cohortCandidateRaceCount
    || value.cohortCandidateRaceIdentities.some((identity) => typeof identity !== "string" || !RACE_IDENTITY_RE.test(identity))
    || new Set(value.cohortCandidateRaceIdentities).size !== value.cohortCandidateRaceIdentities.length) {
    throw new Error("READINESS_CATALOG_ARTIFACT_COHORT_INVALID");
  }
  if (!isNonNegativeInteger(value.totalSnapshotCount) || value.totalSnapshotCount > 48
    || !isNonNegativeInteger(value.totalTransitionCount)
    || value.checkpointCoverageNumerator !== value.totalSnapshotCount
    || value.checkpointCoverageDenominator !== 48
    || typeof value.checkpointCoverageRatio !== "number"
    || value.checkpointCoverageRatio !== Number((value.totalSnapshotCount / 48).toFixed(6))) {
    throw new Error("READINESS_CATALOG_ARTIFACT_COVERAGE_INVALID");
  }
  if (typeof value.heartbeatStatus !== "string" || typeof value.heartbeatPlanStatus !== "string"
    || typeof value.heartbeatOutputDigest !== "string" || !DIGEST_RE.test(value.heartbeatOutputDigest)
    || !isNonNegativeInteger(value.heartbeatSignificantGapCount)
    || !isNonNegativeInteger(value.heartbeatAffectedCheckpointCount)
    || typeof value.heartbeatCurrentGapOverThreshold !== "boolean") {
    throw new Error("READINESS_CATALOG_ARTIFACT_HEARTBEAT_INVALID");
  }
  if (value.automaticFreezeAuthorized !== false
    || value.outcomeDataRead !== false || value.validationDataRead !== false || value.holdoutDataRead !== false
    || value.rawCaptureEvidenceRead !== false || value.rawOddsValuesRead !== false || value.rawOddsValuesPrinted !== false
    || value.rawOddsValuesPublished !== false || value.networkRequestCount !== 0
    || value.databaseReadCount !== 0 || value.databaseWriteCount !== 0
    || value.currentBuyConnectionAuthorized !== false || value.lineConnectionAuthorized !== false
    || value.automatedBettingAuthorized !== false || value.publicPublishAuthorized !== false
    || value.productionApplyAuthorized !== false) {
    throw new Error("READINESS_CATALOG_ARTIFACT_PROTECTED_BOUNDARY_INVALID");
  }
  return value as unknown as N2TrifectaPrivateMarketDailyReadiness;
}

function scanVerifiedArtifacts(rootDir: string): VerifiedReadinessArtifact[] {
  const rootPath = resolveInside(rootDir, READINESS_ROOT_RELATIVE);
  if (!existsSync(rootPath)) return [];
  requirePrivateDirectory(rootPath, "READINESS_CATALOG_ROOT_INVALID");
  const artifacts: VerifiedReadinessArtifact[] = [];

  for (const dateName of readdirSync(rootPath).sort()) {
    if (dateName === "catalog.json") continue;
    if (!DATE_RE.test(dateName)) throw new Error("READINESS_CATALOG_DATE_DIRECTORY_INVALID");
    const datePath = join(rootPath, dateName);
    requirePrivateDirectory(datePath, "READINESS_CATALOG_DATE_DIRECTORY_TYPE_INVALID");
    for (const venueName of readdirSync(datePath).sort()) {
      if (!VENUE_RE.test(venueName)) throw new Error("READINESS_CATALOG_VENUE_DIRECTORY_INVALID");
      const venuePath = join(datePath, venueName);
      requirePrivateDirectory(venuePath, "READINESS_CATALOG_VENUE_DIRECTORY_TYPE_INVALID");
      for (const filename of readdirSync(venuePath).sort()) {
        const match = /^([0-9a-f]{64})\.json$/u.exec(filename);
        if (!match) throw new Error("READINESS_CATALOG_ARTIFACT_FILENAME_INVALID");
        const digest = match[1];
        const value = readJsonObject(
          join(venuePath, filename),
          MAX_READINESS_ARTIFACT_BYTES,
          "READINESS_CATALOG_ARTIFACT",
        );
        const artifact = validateReadinessArtifact({
          value,
          expectedDate: dateName,
          expectedVenueCode: venueName,
          expectedDigest: digest,
        });
        artifacts.push({ artifact, date: dateName, venueCode: venueName, outputDigest: digest });
      }
    }
  }
  return artifacts;
}

function scopeKey(date: string, venueCode: string): string {
  return `${date}|${venueCode}`;
}

export function buildN2TrifectaPrivateMarketReadinessCatalog(input: {
  dataRoot: string;
  generatedAt?: string;
}): N2TrifectaPrivateMarketReadinessCatalog {
  const generatedAtMs = parseInstant(input.generatedAt ?? new Date().toISOString());
  if (generatedAtMs == null) throw new Error("READINESS_CATALOG_GENERATED_AT_INVALID");
  const generatedAt = new Date(generatedAtMs).toISOString();
  const artifacts = scanVerifiedArtifacts(input.dataRoot);
  const byScope = new Map<string, VerifiedReadinessArtifact[]>();
  for (const artifact of artifacts) {
    const key = scopeKey(artifact.date, artifact.venueCode);
    const current = byScope.get(key) ?? [];
    current.push(artifact);
    byScope.set(key, current);
  }

  const entries: N2TrifectaPrivateMarketReadinessCatalogEntry[] = [];
  for (const values of byScope.values()) {
    values.sort((left, right) => {
      const time = Date.parse(left.artifact.checkedAt) - Date.parse(right.artifact.checkedAt);
      return time !== 0 ? time : left.outputDigest.localeCompare(right.outputDigest);
    });
    const latest = values.at(-1)!;
    const artifact = latest.artifact;
    entries.push({
      date: latest.date,
      venueCode: latest.venueCode,
      latestCheckedAt: artifact.checkedAt,
      readinessStatus: artifact.status,
      readinessDigest: latest.outputDigest,
      sourceDayIndexDigest: artifact.sourceDayIndexDigest,
      sourceDayIndexStatus: artifact.sourceDayIndexStatus,
      completeRaceCount: artifact.completeRaceCount,
      partialRaceCount: artifact.partialRaceCount,
      noDataRaceCount: artifact.noDataRaceCount,
      cohortCandidateRaceCount: artifact.cohortCandidateRaceCount,
      checkpointCoverageNumerator: artifact.checkpointCoverageNumerator,
      checkpointCoverageDenominator: 48,
      checkpointCoverageRatio: artifact.checkpointCoverageRatio,
      heartbeatStatus: artifact.heartbeatStatus,
      heartbeatSignificantGapCount: artifact.heartbeatSignificantGapCount,
      heartbeatAffectedCheckpointCount: artifact.heartbeatAffectedCheckpointCount,
      heartbeatCurrentGapOverThreshold: artifact.heartbeatCurrentGapOverThreshold,
      heartbeatPlanStatus: artifact.heartbeatPlanStatus,
      scopeArtifactCount: values.length,
    });
  }
  entries.sort((left, right) => scopeKey(left.date, left.venueCode).localeCompare(scopeKey(right.date, right.venueCode)));
  const dates = entries.map((entry) => entry.date).sort();
  const core = {
    catalogVersion: N2_TRIFECTA_PRIVATE_MARKET_READINESS_CATALOG_VERSION,
    evidenceRole: "EXPLORATION_READINESS_CATALOG_ONLY" as const,
    generatedAt,
    sourceArtifactCount: artifacts.length,
    entryCount: entries.length,
    earliestDate: dates.at(0) ?? null,
    latestDate: dates.at(-1) ?? null,
    fullCoverageScopeCount: entries.filter((entry) => entry.checkpointCoverageNumerator === 48).length,
    entries,
    privateResearchOnly: true as const,
    automaticFreezeAuthorized: false as const,
    outcomeDataRead: false as const,
    validationDataRead: false as const,
    holdoutDataRead: false as const,
    rawCaptureEvidenceRead: false as const,
    rawOddsValuesRead: false as const,
    rawOddsValuesPublished: false as const,
    networkRequestCount: 0 as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    publicPublishAuthorized: false as const,
    productionApplyAuthorized: false as const,
  };
  return { ...core, catalogDigest: canonicalHash(core) };
}

function atomicMode0600Replace(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const parent = lstatSync(dirname(path));
  if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error("READINESS_CATALOG_PARENT_INVALID");
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
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error("READINESS_CATALOG_FINAL_MODE_INVALID");
}

function reusableExistingCatalog(input: {
  path: string;
  next: N2TrifectaPrivateMarketReadinessCatalog;
}): { digest: string; semanticEqual: boolean } | null {
  if (!existsSync(input.path)) return null;
  let existing: Record<string, unknown>;
  try {
    existing = readJsonObject(input.path, MAX_CATALOG_BYTES, "READINESS_CATALOG_EXISTING");
  } catch {
    return null;
  }
  if (existing.catalogVersion !== N2_TRIFECTA_PRIVATE_MARKET_READINESS_CATALOG_VERSION
    || typeof existing.catalogDigest !== "string" || !DIGEST_RE.test(existing.catalogDigest)
    || typeof existing.generatedAt !== "string" || parseInstant(existing.generatedAt) == null) {
    return null;
  }
  const existingDigest = existing.catalogDigest;
  const { catalogDigest: _existingDigest, ...existingCore } = existing;
  if (canonicalHash(existingCore) !== existingDigest) return null;
  if (existingDigest === input.next.catalogDigest) return { digest: existingDigest, semanticEqual: true };
  const { generatedAt: _existingGeneratedAt, ...existingSemanticCore } = existingCore;
  const { catalogDigest: _nextDigest, generatedAt: _nextGeneratedAt, ...nextSemanticCore } = input.next;
  return {
    digest: existingDigest,
    semanticEqual: canonicalHash(existingSemanticCore) === canonicalHash(nextSemanticCore),
  };
}

export function privateMarketReadinessCatalogRelativePath(): string {
  return CATALOG_RELATIVE_PATH;
}

export function writeN2TrifectaPrivateMarketReadinessCatalog(input: {
  dataRoot: string;
  catalog: N2TrifectaPrivateMarketReadinessCatalog;
}): {
  relativePath: string;
  changed: boolean;
  replacedExisting: boolean;
  catalogDigest: string;
  fileMode: 0o600;
} {
  const { catalogDigest, ...core } = input.catalog;
  if (!DIGEST_RE.test(catalogDigest) || canonicalHash(core) !== catalogDigest) {
    throw new Error("READINESS_CATALOG_OUTPUT_DIGEST_MISMATCH");
  }
  const relativePath = privateMarketReadinessCatalogRelativePath();
  const path = resolveInside(input.dataRoot, relativePath);
  const existed = existsSync(path);
  const reusable = reusableExistingCatalog({ path, next: input.catalog });
  if (reusable?.semanticEqual) {
    return {
      relativePath,
      changed: false,
      replacedExisting: true,
      catalogDigest: reusable.digest,
      fileMode: 0o600,
    };
  }
  atomicMode0600Replace(path, `${JSON.stringify(input.catalog, null, 2)}\n`);
  return {
    relativePath,
    changed: true,
    replacedExisting: existed,
    catalogDigest,
    fileMode: 0o600,
  };
}
