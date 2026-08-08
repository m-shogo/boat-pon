import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { canonicalHash } from "./canonical";
import {
  N2_EDGE_DISCOVERY_FROM_DATE,
  N2_EDGE_DISCOVERY_TO_DATE,
} from "./n2EdgeDiscoveryCohort";
import type { N2HistoricalOutcomeRow } from "./n2HistoricalOnlyBaselineDataset";

export const N2_EDGE_DISCOVERY_SOURCE_VERSION = "n2-edge-discovery-source-v1" as const;
export const N2_EDGE_DISCOVERY_HISTORY_FROM_DATE = "2003-07-05" as const;

const PRIMARY_RACE_ID_RE = /^(\d{4})(\d{2})(\d{2})-(0[1-9]|1\d|2[0-4])-(0[1-9]|1[0-2])$/u;
const CANONICAL_RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const TRIFECTA_SELECTION_RE = /^[1-6]-[1-6]-[1-6]$/u;

export type N2EdgeDiscoveryCandidate = {
  canonicalRaceKey: string;
  primaryRaceId: string;
  decisionCutoff: string;
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
  candidateRaceCount: number;
  missingOfficialProgramCount: number;
  missingCleanWinnerCount: number;
  primaryRaceIdParseFailureCount: number;
  decisionCutoffInvalidCount: number;
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

type WinnerRow = { raceKey: string; winningSelection: string | null };
type ProgramRow = { raceId: string; closeAt: string };

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function validSelection(value: string): boolean {
  if (!TRIFECTA_SELECTION_RE.test(value)) return false;
  return new Set(value.split("-")).size === 3;
}

export function canonicalRaceKeyFromPrimaryRaceId(raceId: string): string | null {
  const match = PRIMARY_RACE_ID_RE.exec(raceId);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))) return null;
  return `${date}:${match[4]}:R${Number(match[5])}`;
}

export function primaryRaceIdFromCanonicalRaceKey(raceKey: string): string | null {
  const match = CANONICAL_RACE_KEY_RE.exec(raceKey);
  if (!match) return null;
  const date = match[1];
  return `${date.replaceAll("-", "")}-${match[2]}-${String(Number(match[3])).padStart(2, "0")}`;
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
      "settlement_candidates_v2",
      "race_payout_lines_v2",
      "settlement_source_duplicate_resolutions_v2",
    ]) {
      if (!tableExists(db, table)) return { rows: [], blockers: [`SIDECAR_TABLE_MISSING:${table}`] };
    }
    const raw = db.prepare(`
      SELECT c.canonical_race_key AS raceKey, p.selection_canonical AS winningSelection
      FROM settlement_candidates_v2 c
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
          SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d
          WHERE d.duplicate_observation_id=c.observation_id
        )
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
    for (const row of raw) {
      const current = grouped.get(row.raceKey) ?? [];
      if (row.winningSelection != null) current.push(row.winningSelection);
      grouped.set(row.raceKey, current);
    }
    const blockers: string[] = [];
    const rows: N2HistoricalOutcomeRow[] = [];
    for (const [raceKey, selections] of grouped.entries()) {
      if (!CANONICAL_RACE_KEY_RE.test(raceKey)) {
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
      SELECT race_id AS raceId, close_at AS closeAt
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
  primaryRaceIdParseFailureCount?: number;
  decisionCutoffInvalidCount?: number;
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
    candidateRaceCount: 0,
    missingOfficialProgramCount: 0,
    missingCleanWinnerCount: 0,
    primaryRaceIdParseFailureCount: input.primaryRaceIdParseFailureCount ?? 0,
    decisionCutoffInvalidCount: input.decisionCutoffInvalidCount ?? 0,
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
  const programByRace = new Map<string, ProgramRow & { canonicalRaceKey: string }>();
  let primaryRaceIdParseFailureCount = 0;
  let decisionCutoffInvalidCount = 0;
  for (const program of programs.rows) {
    const canonicalRaceKey = canonicalRaceKeyFromPrimaryRaceId(program.raceId);
    if (canonicalRaceKey == null) {
      primaryRaceIdParseFailureCount += 1;
      continue;
    }
    if (!Number.isFinite(Date.parse(program.closeAt))) {
      decisionCutoffInvalidCount += 1;
      continue;
    }
    if (programByRace.has(canonicalRaceKey)) blockers.push(`${canonicalRaceKey}:DUPLICATE_OFFICIAL_PROGRAM`);
    programByRace.set(canonicalRaceKey, { ...program, canonicalRaceKey });
  }
  if (primaryRaceIdParseFailureCount > 0) blockers.push(`PRIMARY_RACE_ID_PARSE_FAILURES:${primaryRaceIdParseFailureCount}`);
  if (decisionCutoffInvalidCount > 0) blockers.push(`DECISION_CUTOFF_INVALID:${decisionCutoffInvalidCount}`);
  if (blockers.length > 0) {
    return blocked({
      blockers,
      primaryReads: 1,
      sidecarReads: 1,
      historicalOutcomeCount: historical.rows.length,
      officialProgramMetadataCount: programs.rows.length,
      primaryRaceIdParseFailureCount,
      decisionCutoffInvalidCount,
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
      primaryRaceId: program.raceId,
      decisionCutoff: program.closeAt,
    });
  }
  let missingCleanWinnerCount = 0;
  for (const raceKey of programByRace.keys()) {
    if (!winnerByRace.has(raceKey)) missingCleanWinnerCount += 1;
  }
  candidates.sort((a, b) => a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));

  const core = {
    readerVersion: N2_EDGE_DISCOVERY_SOURCE_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    historyFromDateInclusive: N2_EDGE_DISCOVERY_HISTORY_FROM_DATE,
    discoveryFromDateInclusive: N2_EDGE_DISCOVERY_FROM_DATE,
    discoveryToDateInclusive: N2_EDGE_DISCOVERY_TO_DATE,
    historicalOutcomeCount: historical.rows.length,
    officialProgramMetadataCount: programs.rows.length,
    candidateRaceCount: candidates.length,
    missingOfficialProgramCount,
    missingCleanWinnerCount,
    primaryRaceIdParseFailureCount,
    decisionCutoffInvalidCount,
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
