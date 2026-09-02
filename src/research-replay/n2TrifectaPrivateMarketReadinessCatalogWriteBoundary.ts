import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import {
  N2_TRIFECTA_PRIVATE_MARKET_READINESS_CATALOG_VERSION,
  privateMarketReadinessCatalogRelativePath,
  writeN2TrifectaPrivateMarketReadinessCatalog,
  type N2TrifectaPrivateMarketReadinessCatalog,
  type N2TrifectaPrivateMarketReadinessCatalogEntry,
} from "./n2TrifectaPrivateMarketReadinessCatalog";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const VENUE_RE = /^(0[1-9]|1\d|2[0-4])$/u;

export function canonicalReadinessCatalogGeneratedAt(input: string | null, now: string): string {
  const candidate = input ?? now;
  try {
    return canonicalUtcTimestamp(candidate);
  } catch {
    throw new Error("READINESS_CATALOG_GENERATED_AT_INVALID");
  }
}

function canonicalInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const canonical = canonicalUtcTimestamp(value);
    return canonical === value ? canonical : null;
  } catch {
    return null;
  }
}

function jstDate(value: string): string | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

function hasValidScopeAuthority(entries: unknown, entryCount: unknown, sourceArtifactCount: unknown): boolean {
  if (!Number.isSafeInteger(entryCount) || (entryCount as number) < 0
    || !Number.isSafeInteger(sourceArtifactCount) || (sourceArtifactCount as number) < 0
    || !Array.isArray(entries) || entries.length !== entryCount) return false;
  const scopes = new Set<string>();
  let scopeArtifactCountTotal = 0;
  for (const value of entries) {
    if (typeof value !== "object" || value == null || Array.isArray(value)) return false;
    const entry = value as Record<string, unknown>;
    const latestCheckedAt = canonicalInstant(entry.latestCheckedAt);
    if (typeof entry.date !== "string" || !DATE_RE.test(entry.date)
      || latestCheckedAt == null || jstDate(latestCheckedAt) !== entry.date
      || typeof entry.venueCode !== "string" || !VENUE_RE.test(entry.venueCode)
      || !Number.isSafeInteger(entry.scopeArtifactCount) || (entry.scopeArtifactCount as number) < 1) return false;
    const scope = `${entry.date}|${entry.venueCode}`;
    if (scopes.has(scope)) return false;
    scopes.add(scope);
    scopeArtifactCountTotal += entry.scopeArtifactCount as number;
    if (!Number.isSafeInteger(scopeArtifactCountTotal)) return false;
  }
  return scopeArtifactCountTotal === sourceArtifactCount;
}

function requireProducerBoundary(catalog: N2TrifectaPrivateMarketReadinessCatalog): void {
  if (catalog.catalogVersion !== N2_TRIFECTA_PRIVATE_MARKET_READINESS_CATALOG_VERSION
    || catalog.evidenceRole !== "EXPLORATION_READINESS_CATALOG_ONLY") {
    throw new Error("READINESS_CATALOG_WRITE_PRODUCER_CONTRACT_INVALID");
  }
  if (catalog.privateResearchOnly !== true
    || catalog.automaticFreezeAuthorized !== false
    || catalog.outcomeDataRead !== false
    || catalog.validationDataRead !== false
    || catalog.holdoutDataRead !== false
    || catalog.rawCaptureEvidenceRead !== false
    || catalog.rawOddsValuesRead !== false
    || catalog.rawOddsValuesPublished !== false
    || catalog.networkRequestCount !== 0
    || catalog.databaseReadCount !== 0
    || catalog.databaseWriteCount !== 0
    || catalog.currentBuyConnectionAuthorized !== false
    || catalog.lineConnectionAuthorized !== false
    || catalog.automatedBettingAuthorized !== false
    || catalog.publicPublishAuthorized !== false
    || catalog.productionApplyAuthorized !== false) {
    throw new Error("READINESS_CATALOG_WRITE_PROTECTED_BOUNDARY_INVALID");
  }
  if (!hasValidScopeAuthority(catalog.entries, catalog.entryCount, catalog.sourceArtifactCount)) {
    throw new Error("READINESS_CATALOG_WRITE_SCOPE_AUTHORITY_INVALID");
  }
}

function asExistingCatalog(value: unknown): N2TrifectaPrivateMarketReadinessCatalog | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.catalogVersion !== N2_TRIFECTA_PRIVATE_MARKET_READINESS_CATALOG_VERSION
    || typeof record.catalogDigest !== "string"
    || !/^[0-9a-f]{64}$/u.test(record.catalogDigest)) return null;
  const { catalogDigest, ...core } = record;
  if (canonicalHash(core) !== catalogDigest) return null;
  if (!hasValidScopeAuthority(record.entries, record.entryCount, record.sourceArtifactCount)) return null;
  return record as unknown as N2TrifectaPrivateMarketReadinessCatalog;
}

function entryMap(entries: N2TrifectaPrivateMarketReadinessCatalogEntry[]): Map<string, N2TrifectaPrivateMarketReadinessCatalogEntry> {
  return new Map(entries.map((entry) => [`${entry.date}|${entry.venueCode}`, entry]));
}

function requireNoCatalogRegression(input: {
  dataRoot: string;
  next: N2TrifectaPrivateMarketReadinessCatalog;
}): void {
  const path = resolve(input.dataRoot, privateMarketReadinessCatalogRelativePath());
  if (!existsSync(path)) return;
  const lst = lstatSync(path);
  const stat = statSync(path);
  if (lst.isSymbolicLink() || !lst.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new Error("READINESS_CATALOG_EXISTING_AUTHORITY_INVALID");
  }
  let existing: N2TrifectaPrivateMarketReadinessCatalog | null = null;
  try {
    existing = asExistingCatalog(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    existing = null;
  }
  if (existing == null) throw new Error("READINESS_CATALOG_EXISTING_AUTHORITY_INVALID");
  if (input.next.sourceArtifactCount < existing.sourceArtifactCount
    || input.next.entryCount < existing.entryCount) {
    throw new Error("READINESS_CATALOG_APPEND_ONLY_REGRESSION");
  }
  const nextByScope = entryMap(input.next.entries);
  for (const previous of existing.entries) {
    const next = nextByScope.get(`${previous.date}|${previous.venueCode}`);
    if (next == null
      || next.scopeArtifactCount < previous.scopeArtifactCount
      || Date.parse(next.latestCheckedAt) < Date.parse(previous.latestCheckedAt)) {
      throw new Error("READINESS_CATALOG_APPEND_ONLY_REGRESSION");
    }
  }
}

export function writeVerifiedN2TrifectaPrivateMarketReadinessCatalog(input: {
  dataRoot: string;
  catalog: N2TrifectaPrivateMarketReadinessCatalog;
}): ReturnType<typeof writeN2TrifectaPrivateMarketReadinessCatalog> {
  requireProducerBoundary(input.catalog);
  requireNoCatalogRegression({ dataRoot: input.dataRoot, next: input.catalog });
  return writeN2TrifectaPrivateMarketReadinessCatalog(input);
}
