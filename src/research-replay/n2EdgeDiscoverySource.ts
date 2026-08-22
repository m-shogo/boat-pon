import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { officialVenueCode } from "../domain/officialLinks";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { canonicalRaceKey } from "./identity";
import { readCurrentlyValidSourceDuplicateObservationIds } from "./n1SourceDuplicateResolutionValidation";
import {
  N2_EDGE_DISCOVERY_FROM_DATE,
  N2_EDGE_DISCOVERY_TO_DATE,
} from "./n2EdgeDiscoveryCohort";
import type { N2HistoricalOutcomeRow } from "./n2HistoricalOnlyBaselineDataset";

export const N2_EDGE_DISCOVERY_SOURCE_VERSION = "n2-edge-discovery-source-v1" as const;
export const N2_EDGE_DISCOVERY_HISTORY_FROM_DATE = "2003-07-05" as const;

const CANONICAL_RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const TRIFECTA_SELECTION_RE = /^[1-6]-[1-6]-[1-6]$/u;
const REUSABLE_PARSE_STATUSES = new Set(["success", "warning"]);

export type N2EdgeDiscoveryCandidate = {
  canonicalRaceKey: string;
  primaryRaceId: string;
  primaryIdentityEncoding: "venue_label" | "venue_code";
  decisionCutoff: string;
  sourceObservedAt: string;
};

export type N2EdgeDiscoverySourceRead = {
  readerVersion: typeof N2_EDGE_DISCOVERY_SOURCE_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  historyFromDateInclusive: typeof N2_EDGE_DISCOVERY_HISTORY_FROM_DATE;
  discoveryFromDateInclusive: typeof N2_EDGE_DISCOVERY_FROM_DATE;
  discoveryToDateInclusive: typeof N2_EDGE_DISCOVERY_TO_DATE;
  historicalOutcomeCount: number;
  officialProgramMetadataCount: number;
  eligibleProgramMetadataCount: number;
  candidateRaceCount: number;
  missingOfficialProgramCount: number;
  missingCleanWinnerCount: number;
  excludedProgramCount: number;
  excludedProgramReasonCounts: Record<string, number>;
  historicalOutcomes: N2HistoricalOutcomeRow[];
  candidates: N2EdgeDiscoveryCandidate[];
  reads: {
    primaryDatabaseReadCount: number;
    sidecarDatabaseReadCount: number;
    rawJsonReadCount: 0;
    primaryDatabaseWriteCount: 0;
    sidecarDatabaseWriteCount: 0;
    networkRequestCount: 0;
  };
  authority: {
    currentBuyConnectionAuthorized: false;
    lineConnectionAuthorized: false;
    publicPublishAuthorized: false;
    automatedBettingAuthorized: false;
    productionApplyAuthorized: false;
  };
  outputDigest: string;
};

type WinnerRow = {
  raceKey: string;
  observationId: string;
  candidateParseRunId: string;
  candidateRawDocumentId: string;
  observationRaceKey: string | null;
  observationType: string | null;
  observationPayloadType: string | null;
  observationParseRunId: string | null;
  observationRawDocumentId: string | null;
  parseRunRawDocumentId: string | null;
  parseRunStatus: string | null;
  winningSelection: string | null;
};
type ProgramRow = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
  importedAt: string;
};
type NormalizedProgram = ProgramRow & N2EdgeDiscoveryCandidate;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function validRaceKey(value: string): boolean {
  const match = CANONICAL_RACE_KEY_RE.exec(value);
  return match !== null && validDate(match[1]);
}

function validSelection(value: string): boolean {
  if (!TRIFECTA_SELECTION_RE.test(value)) return false;
  return new Set(value.split("-")).size === 3;
}

export function canonicalDatabaseTimestamp(value: string): string {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return canonicalUtcTimestamp(normalized);
}

export function officialProgramDecisionCutoffUtc(date: string, closeAt: string): string {
  if (!validDate(date)) throw new Error("INVALID_RACE_DATE");
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(closeAt);
  if (match === null) throw new Error("INVALID_CLOSE_AT");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) throw new Error("INVALID_CLOSE_AT");
  const time = `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
  const parsed = Date.parse(`${date}T${time}+09:00`);
  if (!Number.isFinite(parsed)) throw new Error("INVALID_CLOSE_AT");
  return new Date(parsed).toISOString();
}

function primaryIdentityEncoding(
  row: ProgramRow,
  venueCode: string,
): "venue_label" | "venue_code" {
  if (!Number.isInteger(row.raceNo) || row.raceNo < 1 || row.raceNo > 12) {
    throw new Error("INVALID_RACE_NO");
  }
  const suffix = String(row.raceNo).padStart(2, "0");
  const compactDate = row.date.replaceAll("-", "");
  const venueToken = row.venue.trim();
  const labelIdentity = `${compactDate}-${venueToken}-${suffix}`;
  const codeIdentity = `${compactDate}-${venueCode}-${suffix}`;
  if (row.raceId === labelIdentity) return venueToken === venueCode ? "venue_code" : "venue_label";
  if (row.raceId === codeIdentity) return "venue_code";
  throw new Error("RACE_IDENTITY_MISMATCH");
}

export function normalizeDiscoveryProgramRow(row: ProgramRow): NormalizedProgram {
  if (!validDate(row.date)) throw new Error("INVALID_RACE_DATE");
  const venueCode = officialVenueCode(row.venue);
  if (venueCode === null) throw new Error("UNKNOWN_VENUE");
  const encoding = primaryIdentityEncoding(row, venueCode);
  const decisionCutoff = officialProgramDecisionCutoffUtc(row.date, row.closeAt);
  const sourceObservedAt = canonicalDatabaseTimestamp(row.importedAt);
  if (Date.parse(sourceObservedAt) >= Date.parse(decisionCutoff)) {
    throw new Error("POST_CUTOFF_PRIMARY_IMPORT");
  }
  return {
    ...row,
    canonicalRaceKey: canonicalRaceKey(row.date, venueCode, row.raceNo),
    primaryRaceId: row.raceId,
    primaryIdentityEncoding: encoding,
    decisionCutoff,
    sourceObservedAt,
  };
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function openReadOnlyPrimary(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON");
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}

function openImmutableSidecar(path: string): DatabaseSync {
  const walPath = `${path}-wal`;
  if (existsSync(walPath) && statSync(walPath).size > 0) throw new Error("SIDECAR_ACTIVE_WAL");
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON");
  return db;
}

function readHistoricalOutcomes(path: string): { rows: N2HistoricalOutcomeRow[]; blockers: string[] } {
  const db = openImmutableSidecar(path);
  try {
    for (const table of [
      "domain_observations",
      "parse_runs",
      "settlement_candidates_v2",
      "race_payout_lines_v2",
      "settlement_source_duplicate_resolutions_v2",
    ]) {
      if (!tableExists(db, table)) return { rows: [], blockers: [`SIDECAR_TABLE_MISSING:${table}`] };
    }
    let validResolvedObservationIds: Set<string>;
    try {
      validResolvedObservationIds = readCurrentlyValidSourceDuplicateObservationIds(db);
    } catch {
      return { rows: [], blockers: ["SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"] };
    }
    const raw = db.prepare(`
      SELECT
        c.canonical_race_key AS raceKey,
        c.observation_id AS observationId,
        c.parse_run_id AS candidateParseRunId,
        c.raw_document_id AS candidateRawDocumentId,
        o.canonical_race_key AS observationRaceKey,
        o.observation_type AS observationType,
        o.payload_type AS observationPayloadType,
        o.parse_run_id AS observationParseRunId,
        o.raw_document_id AS observationRawDocumentId,
        pr.raw_document_id AS parseRunRawDocumentId,
        pr.status AS parseRunStatus,
        p.selection_canonical AS winningSelection
      FROM settlement_candidates_v2 c
      LEFT JOIN domain_observations o ON o.observation_id=c.observation_id
      LEFT JOIN parse_runs pr ON pr.parse_run_id=c.parse_run_id
      JOIN race_payout_lines_v2 p
        ON p.candidate_id=c.candidate_id
       AND p.bet_type='trifecta'
       AND p.line_kind='payout'
       AND p.selection_canonical IS NOT NULL
      WHERE c.bet_type='trifecta'
        AND c.settlement_status='settled'
        AND c.result_kind='normal'
        AND c.resolution_status='resolved'
        AND substr(c.canonical_race_key,1,10) >= ?
        AND substr(c.canonical_race_key,1,10) <= ?
        AND NOT EXISTS (
          SELECT 1 FROM settlement_candidates_v2 newer
          WHERE newer.supersedes_candidate_id=c.candidate_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM race_payout_lines_v2 special
          WHERE special.candidate_id=c.candidate_id
            AND special.bet_type='trifecta'
            AND special.line_kind='special_payout'
        )
      ORDER BY c.canonical_race_key,p.line_no
    `).all(N2_EDGE_DISCOVERY_HISTORY_FROM_DATE, N2_EDGE_DISCOVERY_TO_DATE) as unknown as WinnerRow[];

    const grouped = new Map<string, string[]>();
    const blockers: string[] = [];
    for (const row of raw) {
      if (validResolvedObservationIds.has(row.observationId)) continue;
      if (row.observationRaceKey !== row.raceKey
        || row.observationType !== "settlement_result"
        || row.observationPayloadType !== "settlement_result"
        || row.observationParseRunId !== row.candidateParseRunId
        || row.observationRawDocumentId !== row.candidateRawDocumentId
        || row.parseRunRawDocumentId !== row.candidateRawDocumentId
        || row.parseRunStatus == null
        || !REUSABLE_PARSE_STATUSES.has(row.parseRunStatus)) {
        blockers.push(`${row.raceKey}:SETTLEMENT_LINEAGE_MISMATCH:${row.observationId}`);
        continue;
      }
      const current = grouped.get(row.raceKey) ?? [];
      if (row.winningSelection != null) current.push(row.winningSelection);
      grouped.set(row.raceKey, current);
    }
    const rows: N2HistoricalOutcomeRow[] = [];
    for (const [raceKey, selections] of grouped.entries()) {
      if (!validRaceKey(raceKey)) {
        blockers.push(`${raceKey}:CANONICAL_RACE_KEY_INVALID`);
        continue;
      }
      if (selections.length !== 1) {
        blockers.push(`${raceKey}:ACTIVE_WINNER_COUNT_${selections.length}`);
        continue;
      }
      if (!validSelection(selections[0])) {
        blockers.push(`${raceKey}:WINNING_SELECTION_INVALID`);
        continue;
      }
      rows.push({ canonicalRaceKey: raceKey, winningSelection: selections[0] });
    }
    rows.sort((a, b) => a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));
    return { rows, blockers: unique(blockers) };
  } finally {
    db.close();
  }
}

function readProgramMetadata(path: string): { rows: ProgramRow[]; blockers: string[] } {
  const db = openReadOnlyPrimary(path);
  try {
    if (!tableExists(db, "official_programs")) return { rows: [], blockers: ["PRIMARY_TABLE_MISSING:official_programs"] };
    const rows = db.prepare(`
      SELECT
        race_id AS raceId,
        date,
        venue,
        race_no AS raceNo,
        close_at AS closeAt,
        imported_at AS importedAt
      FROM official_programs
      WHERE date >= ? AND date <= ?
      ORDER BY date,race_no,race_id
    `).all(N2_EDGE_DISCOVERY_FROM_DATE, N2_EDGE_DISCOVERY_TO_DATE) as unknown as ProgramRow[];
    return { rows, blockers: [] };
  } finally {
    db.close();
  }
}

function blocked(input: {
  blockers: string[];
  primaryReads: number;
  sidecarReads: number;
  historicalOutcomeCount?: number;
  officialProgramMetadataCount?: number;
}): N2EdgeDiscoverySourceRead {
  const core = {
    readerVersion: N2_EDGE_DISCOVERY_SOURCE_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(input.blockers),
    historyFromDateInclusive: N2_EDGE_DISCOVERY_HISTORY_FROM_DATE,
    discoveryFromDateInclusive: N2_EDGE_DISCOVERY_FROM_DATE,
    discoveryToDateInclusive: N2_EDGE_DISCOVERY_TO_DATE,
    historicalOutcomeCount: input.historicalOutcomeCount ?? 0,
    officialProgramMetadataCount: input.officialProgramMetadataCount ?? 0,
    eligibleProgramMetadataCount: 0,
    candidateRaceCount: 0,
    missingOfficialProgramCount: 0,
    missingCleanWinnerCount: 0,
    excludedProgramCount: 0,
    excludedProgramReasonCounts: {} as Record<string, number>,
    historicalOutcomes: [] as N2HistoricalOutcomeRow[],
    candidates: [] as N2EdgeDiscoveryCandidate[],
    reads: {
      primaryDatabaseReadCount: input.primaryReads,
      sidecarDatabaseReadCount: input.sidecarReads,
      rawJsonReadCount: 0 as const,
      primaryDatabaseWriteCount: 0 as const,
      sidecarDatabaseWriteCount: 0 as const,
      networkRequestCount: 0 as const,
    },
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

export function readN2EdgeDiscoverySource(input: {
  primaryDbPath: string;
  sidecarDbPath: string;
}): N2EdgeDiscoverySourceRead {
  let historical: ReturnType<typeof readHistoricalOutcomes>;
  try {
    historical = readHistoricalOutcomes(input.sidecarDbPath);
  } catch (error) {
    return blocked({
      blockers: [error instanceof Error ? error.message : "SIDECAR_DISCOVERY_READ_FAILED"],
      primaryReads: 0,
      sidecarReads: 0,
    });
  }
  if (historical.blockers.length > 0) {
    return blocked({
      blockers: historical.blockers,
      primaryReads: 0,
      sidecarReads: 1,
      historicalOutcomeCount: historical.rows.length,
    });
  }

  let programs: ReturnType<typeof readProgramMetadata>;
  try {
    programs = readProgramMetadata(input.primaryDbPath);
  } catch (error) {
    return blocked({
      blockers: [error instanceof Error ? error.message : "PRIMARY_DISCOVERY_READ_FAILED"],
      primaryReads: 0,
      sidecarReads: 1,
      historicalOutcomeCount: historical.rows.length,
    });
  }
  if (programs.blockers.length > 0) {
    return blocked({
      blockers: programs.blockers,
      primaryReads: 1,
      sidecarReads: 1,
      historicalOutcomeCount: historical.rows.length,
      officialProgramMetadataCount: programs.rows.length,
    });
  }

  const blockers: string[] = [];
  const programByRace = new Map<string, NormalizedProgram>();
  const excludedProgramReasonCounts: Record<string, number> = {};
  for (const program of programs.rows) {
    try {
      const normalized = normalizeDiscoveryProgramRow(program);
      if (programByRace.has(normalized.canonicalRaceKey)) {
        blockers.push(`${normalized.canonicalRaceKey}:DUPLICATE_ELIGIBLE_OFFICIAL_PROGRAM`);
        continue;
      }
      programByRace.set(normalized.canonicalRaceKey, normalized);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "UNKNOWN_PROGRAM_METADATA_ERROR";
      excludedProgramReasonCounts[reason] = (excludedProgramReasonCounts[reason] ?? 0) + 1;
    }
  }
  if (blockers.length > 0) {
    return blocked({
      blockers,
      primaryReads: 1,
      sidecarReads: 1,
      historicalOutcomeCount: historical.rows.length,
      officialProgramMetadataCount: programs.rows.length,
    });
  }

  const winnerByRace = new Map(historical.rows.map((row) => [row.canonicalRaceKey, row.winningSelection]));
  const discoveryOutcomes = historical.rows.filter((row) => {
    const date = row.canonicalRaceKey.slice(0, 10);
    return date >= N2_EDGE_DISCOVERY_FROM_DATE && date <= N2_EDGE_DISCOVERY_TO_DATE;
  });
  const candidates: N2EdgeDiscoveryCandidate[] = [];
  let missingOfficialProgramCount = 0;
  for (const outcome of discoveryOutcomes) {
    const program = programByRace.get(outcome.canonicalRaceKey);
    if (!program) {
      missingOfficialProgramCount += 1;
      continue;
    }
    candidates.push({
      canonicalRaceKey: outcome.canonicalRaceKey,
      primaryRaceId: program.primaryRaceId,
      primaryIdentityEncoding: program.primaryIdentityEncoding,
      decisionCutoff: program.decisionCutoff,
      sourceObservedAt: program.sourceObservedAt,
    });
  }
  let missingCleanWinnerCount = 0;
  for (const raceKey of programByRace.keys()) {
    if (!winnerByRace.has(raceKey)) missingCleanWinnerCount += 1;
  }
  candidates.sort((a, b) => a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));
  const excludedProgramCount = Object.values(excludedProgramReasonCounts).reduce((sum, count) => sum + count, 0);

  const core = {
    readerVersion: N2_EDGE_DISCOVERY_SOURCE_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    historyFromDateInclusive: N2_EDGE_DISCOVERY_HISTORY_FROM_DATE,
    discoveryFromDateInclusive: N2_EDGE_DISCOVERY_FROM_DATE,
    discoveryToDateInclusive: N2_EDGE_DISCOVERY_TO_DATE,
    historicalOutcomeCount: historical.rows.length,
    officialProgramMetadataCount: programs.rows.length,
    eligibleProgramMetadataCount: programByRace.size,
    candidateRaceCount: candidates.length,
    missingOfficialProgramCount,
    missingCleanWinnerCount,
    excludedProgramCount,
    excludedProgramReasonCounts: Object.fromEntries(Object.entries(excludedProgramReasonCounts).sort(([a], [b]) => a.localeCompare(b))),
    historicalOutcomes: historical.rows,
    candidates,
    reads: {
      primaryDatabaseReadCount: 1,
      sidecarDatabaseReadCount: 1,
      rawJsonReadCount: 0 as const,
      primaryDatabaseWriteCount: 0 as const,
      sidecarDatabaseWriteCount: 0 as const,
      networkRequestCount: 0 as const,
    },
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
