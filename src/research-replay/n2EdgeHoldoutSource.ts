import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { canonicalHash } from "./canonical";
import {
  normalizeDiscoveryProgramRow,
  type N2EdgeDiscoveryCandidate,
} from "./n2EdgeDiscoverySource";
import {
  N2_EDGE_TEST_TO_DATE,
  N2_EDGE_VALIDATION_FROM_DATE,
} from "./n2EdgeHoldoutCohort";
import type { N2HistoricalOutcomeRow } from "./n2HistoricalOnlyBaselineDataset";

export const N2_EDGE_HOLDOUT_SOURCE_VERSION = "n2-edge-holdout-source-v1" as const;
export const N2_EDGE_HOLDOUT_HISTORY_FROM_DATE = "2021-07-05" as const;

const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const SELECTION_RE = /^[1-6]-[1-6]-[1-6]$/u;

type WinnerRow = { raceKey: string; winningSelection: string | null };
type ProgramRow = { raceId: string; date: string; venue: string; raceNo: number; closeAt: string; importedAt: string };

export type N2EdgeHoldoutSourceRead = {
  readerVersion: typeof N2_EDGE_HOLDOUT_SOURCE_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  historyFromDateInclusive: typeof N2_EDGE_HOLDOUT_HISTORY_FROM_DATE;
  holdoutFromDateInclusive: typeof N2_EDGE_VALIDATION_FROM_DATE;
  holdoutToDateInclusive: typeof N2_EDGE_TEST_TO_DATE;
  historicalOutcomeCount: number;
  officialProgramMetadataCount: number;
  eligibleProgramMetadataCount: number;
  candidateRaceCount: number;
  excludedProgramCount: number;
  excludedProgramReasonCounts: Record<string, number>;
  missingOfficialProgramCount: number;
  missingCleanWinnerCount: number;
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
  outputDigest: string;
};

function unique(values: string[]): string[] { return [...new Set(values)].sort(); }
function validSelection(value: string): boolean { return SELECTION_RE.test(value) && new Set(value.split("-")).size === 3; }
function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
function openPrimary(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON"); db.exec("PRAGMA busy_timeout=5000"); return db;
}
function openSidecar(path: string): DatabaseSync {
  const wal = `${path}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) throw new Error("SIDECAR_ACTIVE_WAL");
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON"); return db;
}

function blocked(blockers: string[], primaryReads = 0, sidecarReads = 0): N2EdgeHoldoutSourceRead {
  const core = {
    readerVersion: N2_EDGE_HOLDOUT_SOURCE_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(blockers),
    historyFromDateInclusive: N2_EDGE_HOLDOUT_HISTORY_FROM_DATE,
    holdoutFromDateInclusive: N2_EDGE_VALIDATION_FROM_DATE,
    holdoutToDateInclusive: N2_EDGE_TEST_TO_DATE,
    historicalOutcomeCount: 0,
    officialProgramMetadataCount: 0,
    eligibleProgramMetadataCount: 0,
    candidateRaceCount: 0,
    excludedProgramCount: 0,
    excludedProgramReasonCounts: {} as Record<string, number>,
    missingOfficialProgramCount: 0,
    missingCleanWinnerCount: 0,
    historicalOutcomes: [] as N2HistoricalOutcomeRow[],
    candidates: [] as N2EdgeDiscoveryCandidate[],
    reads: {
      primaryDatabaseReadCount: primaryReads,
      sidecarDatabaseReadCount: sidecarReads,
      rawJsonReadCount: 0 as const,
      primaryDatabaseWriteCount: 0 as const,
      sidecarDatabaseWriteCount: 0 as const,
      networkRequestCount: 0 as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function readN2EdgeHoldoutSource(input: { primaryDbPath: string; sidecarDbPath: string }): N2EdgeHoldoutSourceRead {
  let sidecar: DatabaseSync;
  try { sidecar = openSidecar(input.sidecarDbPath); }
  catch (error) { return blocked([error instanceof Error ? error.message : "SIDECAR_OPEN_FAILED"]); }
  const historicalOutcomes: N2HistoricalOutcomeRow[] = [];
  const blockers: string[] = [];
  try {
    for (const table of ["settlement_candidates_v2","race_payout_lines_v2","settlement_source_duplicate_resolutions_v2"]) {
      if (!tableExists(sidecar, table)) return blocked([`SIDECAR_TABLE_MISSING:${table}`],0,1);
    }
    const rows = sidecar.prepare(`
      SELECT c.canonical_race_key AS raceKey, p.selection_canonical AS winningSelection
      FROM settlement_candidates_v2 c
      JOIN race_payout_lines_v2 p ON p.candidate_id=c.candidate_id
       AND p.bet_type='trifecta' AND p.line_kind='payout' AND p.selection_canonical IS NOT NULL
      WHERE c.bet_type='trifecta' AND c.settlement_status='settled' AND c.result_kind='normal'
       AND c.resolution_status='resolved'
       AND substr(c.canonical_race_key,1,10) >= ? AND substr(c.canonical_race_key,1,10) <= ?
       AND NOT EXISTS (SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id=c.observation_id)
       AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 newer WHERE newer.supersedes_candidate_id=c.candidate_id)
       AND NOT EXISTS (SELECT 1 FROM race_payout_lines_v2 special WHERE special.candidate_id=c.candidate_id AND special.bet_type='trifecta' AND special.line_kind='special_payout')
      ORDER BY c.canonical_race_key,p.line_no
    `).all(N2_EDGE_HOLDOUT_HISTORY_FROM_DATE,N2_EDGE_TEST_TO_DATE) as unknown as WinnerRow[];
    const grouped = new Map<string,string[]>();
    for (const row of rows) {
      const current=grouped.get(row.raceKey)??[]; if(row.winningSelection!=null) current.push(row.winningSelection); grouped.set(row.raceKey,current);
    }
    for (const [raceKey,selections] of grouped) {
      if (!RACE_KEY_RE.test(raceKey)) { blockers.push(`${raceKey}:RACE_KEY_INVALID`); continue; }
      if (selections.length!==1) { blockers.push(`${raceKey}:ACTIVE_WINNER_COUNT_${selections.length}`); continue; }
      if (!validSelection(selections[0])) { blockers.push(`${raceKey}:WINNING_SELECTION_INVALID`); continue; }
      historicalOutcomes.push({canonicalRaceKey:raceKey,winningSelection:selections[0]});
    }
  } finally { sidecar.close(); }
  if (blockers.length) return blocked(blockers,0,1);
  historicalOutcomes.sort((a,b)=>a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));

  let primary: DatabaseSync;
  try { primary=openPrimary(input.primaryDbPath); }
  catch (error) { return blocked([error instanceof Error ? error.message : "PRIMARY_OPEN_FAILED"],0,1); }
  let programs: ProgramRow[]=[];
  try {
    if(!tableExists(primary,"official_programs")) return blocked(["PRIMARY_TABLE_MISSING:official_programs"],1,1);
    programs=primary.prepare(`SELECT race_id AS raceId,date,venue,race_no AS raceNo,close_at AS closeAt,imported_at AS importedAt
      FROM official_programs WHERE date>=? AND date<=? ORDER BY date,race_no,race_id`)
      .all(N2_EDGE_VALIDATION_FROM_DATE,N2_EDGE_TEST_TO_DATE) as unknown as ProgramRow[];
  } finally { primary.close(); }

  const programByRace=new Map<string,ReturnType<typeof normalizeDiscoveryProgramRow>>();
  const excluded:Record<string,number>={};
  for(const row of programs){
    try{
      const normalized=normalizeDiscoveryProgramRow(row);
      if(programByRace.has(normalized.canonicalRaceKey)){ blockers.push(`${normalized.canonicalRaceKey}:DUPLICATE_ELIGIBLE_OFFICIAL_PROGRAM`); continue; }
      programByRace.set(normalized.canonicalRaceKey,normalized);
    }catch(error){ const reason=error instanceof Error?error.message:"PROGRAM_METADATA_INVALID"; excluded[reason]=(excluded[reason]??0)+1; }
  }
  if(blockers.length) return blocked(blockers,1,1);
  const winnerByRace=new Map(historicalOutcomes.map(row=>[row.canonicalRaceKey,row.winningSelection]));
  const holdoutOutcomes=historicalOutcomes.filter(row=>{const d=row.canonicalRaceKey.slice(0,10);return d>=N2_EDGE_VALIDATION_FROM_DATE&&d<=N2_EDGE_TEST_TO_DATE;});
  const candidates:N2EdgeDiscoveryCandidate[]=[]; let missingOfficialProgramCount=0;
  for(const outcome of holdoutOutcomes){
    const program=programByRace.get(outcome.canonicalRaceKey); if(!program){missingOfficialProgramCount+=1;continue;}
    candidates.push({canonicalRaceKey:outcome.canonicalRaceKey,primaryRaceId:program.primaryRaceId,primaryIdentityEncoding:program.primaryIdentityEncoding,decisionCutoff:program.decisionCutoff,sourceObservedAt:program.sourceObservedAt});
  }
  let missingCleanWinnerCount=0; for(const key of programByRace.keys()) if(!winnerByRace.has(key)) missingCleanWinnerCount+=1;
  candidates.sort((a,b)=>a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));
  const core={
    readerVersion:N2_EDGE_HOLDOUT_SOURCE_VERSION,status:"PASS" as const,blockers:[] as string[],
    historyFromDateInclusive:N2_EDGE_HOLDOUT_HISTORY_FROM_DATE,holdoutFromDateInclusive:N2_EDGE_VALIDATION_FROM_DATE,holdoutToDateInclusive:N2_EDGE_TEST_TO_DATE,
    historicalOutcomeCount:historicalOutcomes.length,officialProgramMetadataCount:programs.length,eligibleProgramMetadataCount:programByRace.size,candidateRaceCount:candidates.length,
    excludedProgramCount:Object.values(excluded).reduce((a,b)=>a+b,0),excludedProgramReasonCounts:Object.fromEntries(Object.entries(excluded).sort(([a],[b])=>a.localeCompare(b))),
    missingOfficialProgramCount,missingCleanWinnerCount,historicalOutcomes,candidates,
    reads:{primaryDatabaseReadCount:1,sidecarDatabaseReadCount:1,rawJsonReadCount:0 as const,primaryDatabaseWriteCount:0 as const,sidecarDatabaseWriteCount:0 as const,networkRequestCount:0 as const},
  };
  return {...core,outputDigest:canonicalHash(core)};
}
