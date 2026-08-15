import { DatabaseSync } from "node:sqlite";

import { officialVenueCode } from "../domain/officialLinks";
import { classifyProgramFeatureSafety } from "../domain/programFeatureSafety";
import { extractProgramFeatures, type ProgramFeatureSnapshot } from "../domain/programFeatures";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { N2_EDGE_DISCOVERY_MAX_RACES } from "./n2EdgeDiscoveryCohort";
import {
  normalizeDiscoveryProgramRow,
  type N2EdgeDiscoveryCandidate,
} from "./n2EdgeDiscoverySource";

export const N2_EDGE_SELECTED_PROGRAM_FEATURES_VERSION =
  "n2-edge-selected-program-features-v1" as const;
export const N2_EDGE_SELECTED_PROGRAM_QUERY_BATCH_SIZE = 400;

export type N2EdgeSelectedProgramFeatureRace = {
  canonicalRaceKey: string;
  primaryRaceId: string;
  decisionCutoff: string;
  sourceObservedAt: string;
  rawDocumentDigest: string;
  programFeatures: ProgramFeatureSnapshot;
};

export type N2EdgeSelectedProgramFeaturesRead = {
  readerVersion: typeof N2_EDGE_SELECTED_PROGRAM_FEATURES_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  requestedRaceCount: number;
  matchedProgramCount: number;
  parsedProgramCount: number;
  safeProgramCount: number;
  rawJsonReadCount: number;
  identityFieldCountPublished: 0;
  liveOnlyFeatureValueCount: 0;
  venueSpecificUnprovenFeatureValueCount: 0;
  primaryDatabaseReadCount: number;
  primaryDatabaseWriteCount: 0;
  networkRequestCount: 0;
  programs: N2EdgeSelectedProgramFeatureRace[];
  authority: {
    currentBuyConnectionAuthorized: false;
    lineConnectionAuthorized: false;
    publicPublishAuthorized: false;
    automatedBettingAuthorized: false;
    productionApplyAuthorized: false;
  };
  outputDigest: string;
};

type RawProgramRow = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
  importedAt: string;
  rawJson: string;
};

const SELECTED_CANONICAL_RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const SELECTED_PRIMARY_RACE_ID_RE = /^(\d{8})-(.+)-(0[1-9]|1[0-2])$/u;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isCanonicalUtcTimestamp(value: string): boolean {
  try {
    return canonicalUtcTimestamp(value) === value;
  } catch {
    return false;
  }
}

function selectedCandidateIdentityValid(candidate: N2EdgeDiscoveryCandidate): boolean {
  const raceKey = SELECTED_CANONICAL_RACE_KEY_RE.exec(candidate.canonicalRaceKey);
  const primaryRaceId = SELECTED_PRIMARY_RACE_ID_RE.exec(candidate.primaryRaceId);
  if (raceKey === null || primaryRaceId === null) return false;

  const date = raceKey[1];
  const venueCode = raceKey[2];
  const raceNo = Number(raceKey[3]);
  const primaryDate = primaryRaceId[1];
  const primaryVenueToken = primaryRaceId[2];
  const primaryRaceNo = Number(primaryRaceId[3]);
  if (primaryDate !== date.replaceAll("-", "") || primaryRaceNo !== raceNo) return false;
  if (officialVenueCode(primaryVenueToken) !== venueCode) return false;

  const actualEncoding = primaryVenueToken === venueCode ? "venue_code" : "venue_label";
  return actualEncoding === candidate.primaryIdentityEncoding;
}

function blocked(input: {
  blockers: string[];
  requestedRaceCount: number;
  matchedProgramCount?: number;
  parsedProgramCount?: number;
  rawJsonReadCount?: number;
  primaryDatabaseReadCount?: number;
}): N2EdgeSelectedProgramFeaturesRead {
  const core = {
    readerVersion: N2_EDGE_SELECTED_PROGRAM_FEATURES_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(input.blockers),
    requestedRaceCount: input.requestedRaceCount,
    matchedProgramCount: input.matchedProgramCount ?? 0,
    parsedProgramCount: input.parsedProgramCount ?? 0,
    safeProgramCount: 0,
    rawJsonReadCount: input.rawJsonReadCount ?? 0,
    identityFieldCountPublished: 0 as const,
    liveOnlyFeatureValueCount: 0 as const,
    venueSpecificUnprovenFeatureValueCount: 0 as const,
    primaryDatabaseReadCount: input.primaryDatabaseReadCount ?? 0,
    primaryDatabaseWriteCount: 0 as const,
    networkRequestCount: 0 as const,
    programs: [] as N2EdgeSelectedProgramFeatureRace[],
    authority: {
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function openReadOnlyPrimary(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON");
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}

function sanitizeProgramFeatures(snapshot: ProgramFeatureSnapshot): ProgramFeatureSnapshot {
  return {
    boats: snapshot.boats.map((boat) => ({
      course: boat.course,
      className: boat.className,
      nationalWinRate: boat.nationalWinRate ?? null,
      nationalTop2Rate: boat.nationalTop2Rate ?? null,
      localWinRate: boat.localWinRate ?? null,
      localTop2Rate: boat.localTop2Rate ?? null,
      motorTop2Rate: boat.motorTop2Rate ?? null,
      boatTop2Rate: boat.boatTop2Rate ?? null,
      venueMotorTop2Rate: null,
      venueBoatTop2Rate: null,
      courseAvgSt: null,
      courseTop3Rate: null,
      flyingCount: null,
      lateStartCount: null,
      exhibitionStResidual: null,
    })),
  };
}

function validateSixCourses(snapshot: ProgramFeatureSnapshot): string[] {
  const courses = snapshot.boats.map((boat) => boat.course).sort((a, b) => a - b);
  const blockers: string[] = [];
  if (snapshot.boats.length !== 6) blockers.push(`BOAT_COUNT_${snapshot.boats.length}/6`);
  if (new Set(courses).size !== courses.length) blockers.push("DUPLICATE_COURSE");
  if (courses.join(",") !== "1,2,3,4,5,6") blockers.push(`COURSE_SET_${courses.join("-")}`);
  return blockers;
}

function metadataMatchesCandidate(
  row: ReturnType<typeof normalizeDiscoveryProgramRow>,
  candidate: N2EdgeDiscoveryCandidate,
): boolean {
  return row.canonicalRaceKey === candidate.canonicalRaceKey
    && row.primaryRaceId === candidate.primaryRaceId
    && row.primaryIdentityEncoding === candidate.primaryIdentityEncoding
    && row.decisionCutoff === candidate.decisionCutoff
    && row.sourceObservedAt === candidate.sourceObservedAt;
}

export function readN2EdgeSelectedProgramFeatures(input: {
  primaryDbPath: string;
  selectedCandidates: N2EdgeDiscoveryCandidate[];
}): N2EdgeSelectedProgramFeaturesRead {
  const requested = [...input.selectedCandidates].sort((a, b) => a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));
  const blockers: string[] = [];
  if (requested.length === 0) blockers.push("NO_SELECTED_CANDIDATES");
  if (requested.length > N2_EDGE_DISCOVERY_MAX_RACES) {
    blockers.push(`SELECTED_RACE_COUNT_EXCEEDS_CAP:${requested.length}/${N2_EDGE_DISCOVERY_MAX_RACES}`);
  }
  if (new Set(requested.map((item) => item.canonicalRaceKey)).size !== requested.length) blockers.push("DUPLICATE_CANONICAL_RACE_KEY");
  if (new Set(requested.map((item) => item.primaryRaceId)).size !== requested.length) blockers.push("DUPLICATE_PRIMARY_RACE_ID");
  for (const candidate of requested) {
    if (!selectedCandidateIdentityValid(candidate)) blockers.push(`${candidate.canonicalRaceKey}:INVALID_SELECTED_IDENTITY`);
    const decisionCutoffValid = isCanonicalUtcTimestamp(candidate.decisionCutoff);
    const sourceObservedAtValid = isCanonicalUtcTimestamp(candidate.sourceObservedAt);
    if (!decisionCutoffValid) blockers.push(`${candidate.canonicalRaceKey}:INVALID_DECISION_CUTOFF`);
    if (!sourceObservedAtValid) blockers.push(`${candidate.canonicalRaceKey}:INVALID_SOURCE_OBSERVED_AT`);
    if (decisionCutoffValid
      && sourceObservedAtValid
      && Date.parse(candidate.sourceObservedAt) >= Date.parse(candidate.decisionCutoff)) {
      blockers.push(`${candidate.canonicalRaceKey}:SOURCE_NOT_PRE_CUTOFF`);
    }
  }
  if (blockers.length > 0) return blocked({ blockers, requestedRaceCount: requested.length });

  let db: DatabaseSync;
  try {
    db = openReadOnlyPrimary(input.primaryDbPath);
  } catch (error) {
    return blocked({
      blockers: [error instanceof Error ? error.message : "PRIMARY_SELECTED_PROGRAM_OPEN_FAILED"],
      requestedRaceCount: requested.length,
    });
  }

  let primaryDatabaseReadCount = 0;
  const rowsByRaceId = new Map<string, RawProgramRow>();
  try {
    for (let offset = 0; offset < requested.length; offset += N2_EDGE_SELECTED_PROGRAM_QUERY_BATCH_SIZE) {
      const batch = requested.slice(offset, offset + N2_EDGE_SELECTED_PROGRAM_QUERY_BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT
          race_id AS raceId,
          date,
          venue,
          race_no AS raceNo,
          close_at AS closeAt,
          imported_at AS importedAt,
          raw_json AS rawJson
        FROM official_programs
        WHERE race_id IN (${placeholders})
        ORDER BY race_id
      `).all(...batch.map((item) => item.primaryRaceId)) as unknown as RawProgramRow[];
      primaryDatabaseReadCount += 1;
      for (const row of rows) {
        if (rowsByRaceId.has(row.raceId)) blockers.push(`${row.raceId}:DUPLICATE_PRIMARY_ROW`);
        rowsByRaceId.set(row.raceId, row);
      }
    }
  } catch (error) {
    db.close();
    return blocked({
      blockers: [error instanceof Error ? error.message : "PRIMARY_SELECTED_PROGRAM_READ_FAILED"],
      requestedRaceCount: requested.length,
      matchedProgramCount: rowsByRaceId.size,
      rawJsonReadCount: rowsByRaceId.size,
      primaryDatabaseReadCount,
    });
  }
  db.close();

  if (rowsByRaceId.size !== requested.length) blockers.push(`MATCHED_PROGRAM_COUNT:${rowsByRaceId.size}/${requested.length}`);
  const programs: N2EdgeSelectedProgramFeatureRace[] = [];
  let parsedProgramCount = 0;
  for (const candidate of requested) {
    const row = rowsByRaceId.get(candidate.primaryRaceId);
    if (!row) {
      blockers.push(`${candidate.canonicalRaceKey}:SELECTED_PROGRAM_MISSING`);
      continue;
    }
    let normalized: ReturnType<typeof normalizeDiscoveryProgramRow>;
    try {
      normalized = normalizeDiscoveryProgramRow(row);
    } catch (error) {
      blockers.push(`${candidate.canonicalRaceKey}:METADATA_REVALIDATION_${error instanceof Error ? error.message : "FAILED"}`);
      continue;
    }
    if (!metadataMatchesCandidate(normalized, candidate)) {
      blockers.push(`${candidate.canonicalRaceKey}:METADATA_CHANGED_AFTER_SELECTION`);
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(row.rawJson);
    } catch {
      blockers.push(`${candidate.canonicalRaceKey}:RAW_JSON_PARSE_FAILED`);
      continue;
    }
    const extracted = extractProgramFeatures(raw);
    parsedProgramCount += 1;
    for (const blocker of validateSixCourses(extracted)) {
      blockers.push(`${candidate.canonicalRaceKey}:${blocker}`);
    }
    const safety = classifyProgramFeatureSafety(extracted, "historical-readonly");
    if (!safety.isHistoricalSafe) {
      blockers.push(`${candidate.canonicalRaceKey}:LIVE_ONLY_FEATURE_PRESENT:${safety.liveOnlyNonNullCount}`);
      continue;
    }
    const safe = sanitizeProgramFeatures(extracted);
    programs.push({
      canonicalRaceKey: candidate.canonicalRaceKey,
      primaryRaceId: candidate.primaryRaceId,
      decisionCutoff: candidate.decisionCutoff,
      sourceObservedAt: candidate.sourceObservedAt,
      rawDocumentDigest: canonicalHash(row.rawJson),
      programFeatures: safe,
    });
  }
  if (programs.length !== requested.length) blockers.push(`SAFE_PROGRAM_COUNT:${programs.length}/${requested.length}`);
  if (blockers.length > 0) {
    return blocked({
      blockers,
      requestedRaceCount: requested.length,
      matchedProgramCount: rowsByRaceId.size,
      parsedProgramCount,
      rawJsonReadCount: rowsByRaceId.size,
      primaryDatabaseReadCount,
    });
  }

  programs.sort((a, b) => a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));
  const core = {
    readerVersion: N2_EDGE_SELECTED_PROGRAM_FEATURES_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    requestedRaceCount: requested.length,
    matchedProgramCount: rowsByRaceId.size,
    parsedProgramCount,
    safeProgramCount: programs.length,
    rawJsonReadCount: rowsByRaceId.size,
    identityFieldCountPublished: 0 as const,
    liveOnlyFeatureValueCount: 0 as const,
    venueSpecificUnprovenFeatureValueCount: 0 as const,
    primaryDatabaseReadCount,
    primaryDatabaseWriteCount: 0 as const,
    networkRequestCount: 0 as const,
    programs,
    authority: {
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
