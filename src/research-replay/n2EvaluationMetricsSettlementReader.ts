import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { canonicalHash } from "./canonical";
import { enumerateBetSelections } from "./n2DatasetContract";
import { readCurrentlyValidSourceDuplicateObservationIds } from "./n1SourceDuplicateResolutionValidation";

export const N2_EVALUATION_METRICS_SETTLEMENT_READER_VERSION =
  "n2-evaluation-metrics-settlement-reader-v1" as const;

const SELECTIONS = new Set(enumerateBetSelections("trifecta"));
const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const REUSABLE_PARSE_STATUSES = new Set(["success", "warning"]);

export type N2EvaluationSettlement = {
  canonicalRaceKey: string;
  winningSelection: string;
  payoutYen: number;
};

export type N2EvaluationMetricsSettlementRead = {
  readerVersion: typeof N2_EVALUATION_METRICS_SETTLEMENT_READER_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  requestedRaceCount: number;
  settlementCount: number;
  settlements: N2EvaluationSettlement[];
  databaseReadCount: number;
  databaseWriteCount: 0;
  networkRequestCount: 0;
  sourcePolicy: "canonical_active_clean_normal_trifecta_payout";
  outputDigest: string;
};

type Row = {
  raceKey: string;
  observationId: string;
  candidateParseRunId: string;
  candidateRawDocumentId: string;
  observationRaceKey: string;
  observationType: string;
  observationPayloadType: string;
  observationParseRunId: string;
  observationRawDocumentId: string;
  parseRunRawDocumentId: string;
  parseRunStatus: string;
  winningSelection: string | null;
  payoutYen: number | null;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function isCanonicalN2EvaluationRaceKey(value: string): boolean {
  const match = RACE_KEY_RE.exec(value);
  if (!match) return false;
  const date = match[1];
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date;
}

function blocked(blockers: string[], requestedRaceCount: number, databaseReadCount: number): N2EvaluationMetricsSettlementRead {
  const core = {
    readerVersion: N2_EVALUATION_METRICS_SETTLEMENT_READER_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(blockers),
    requestedRaceCount,
    settlementCount: 0,
    settlements: [] as N2EvaluationSettlement[],
    databaseReadCount,
    databaseWriteCount: 0 as const,
    networkRequestCount: 0 as const,
    sourcePolicy: "canonical_active_clean_normal_trifecta_payout" as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function openImmutable(path: string): DatabaseSync {
  const walPath = `${path}-wal`;
  if (existsSync(walPath) && statSync(walPath).size > 0) throw new Error("SIDECAR_ACTIVE_WAL");
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON");
  return db;
}

export function readN2EvaluationMetricsSettlements(input: {
  sidecarDbPath: string;
  raceKeys: string[];
}): N2EvaluationMetricsSettlementRead {
  const requested = [...input.raceKeys];
  const blockers: string[] = [];
  if (requested.length === 0) blockers.push("NO_RACE_KEYS");
  if (new Set(requested).size !== requested.length) blockers.push("DUPLICATE_RACE_KEY_REQUEST");
  for (const raceKey of requested) {
    if (!isCanonicalN2EvaluationRaceKey(raceKey)) blockers.push(`RACE_KEY_INVALID:${raceKey}`);
  }
  if (blockers.length > 0) return blocked(blockers, requested.length, 0);

  let db: DatabaseSync;
  try {
    db = openImmutable(input.sidecarDbPath);
  } catch (error) {
    return blocked([error instanceof Error ? error.message : "SIDECAR_OPEN_FAILED"], requested.length, 0);
  }
  try {
    for (const table of [
      "domain_observations",
      "parse_runs",
      "settlement_candidates_v2",
      "race_payout_lines_v2",
      "settlement_source_duplicate_resolutions_v2",
    ]) {
      if (!tableExists(db, table)) return blocked([`SIDECAR_TABLE_MISSING:${table}`], requested.length, 1);
    }
    let validResolvedObservationIds: Set<string>;
    try {
      validResolvedObservationIds = readCurrentlyValidSourceDuplicateObservationIds(db);
    } catch {
      return blocked(["SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"], requested.length, 1);
    }
    const placeholders = requested.map(() => "?").join(",");
    const rows = db.prepare(`
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
        p.selection_canonical AS winningSelection,
        p.payout_yen AS payoutYen
      FROM settlement_candidates_v2 c
      JOIN domain_observations o
        ON o.observation_id=c.observation_id
      JOIN parse_runs pr
        ON pr.parse_run_id=c.parse_run_id
      JOIN race_payout_lines_v2 p
        ON p.candidate_id=c.candidate_id
       AND p.bet_type='trifecta'
       AND p.line_kind='payout'
       AND p.selection_canonical IS NOT NULL
      WHERE c.bet_type='trifecta'
        AND c.settlement_status='settled'
        AND c.result_kind='normal'
        AND c.resolution_status='resolved'
        AND c.canonical_race_key IN (${placeholders})
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
    `).all(...requested) as unknown as Row[];

    const grouped = new Map<string, Row[]>();
    for (const row of rows) {
      if (validResolvedObservationIds.has(row.observationId)) continue;
      if (row.observationRaceKey !== row.raceKey
        || row.observationType !== "settlement_result"
        || row.observationPayloadType !== "settlement_result"
        || row.observationParseRunId !== row.candidateParseRunId
        || row.observationRawDocumentId !== row.candidateRawDocumentId
        || row.parseRunRawDocumentId !== row.candidateRawDocumentId
        || !REUSABLE_PARSE_STATUSES.has(row.parseRunStatus)) {
        blockers.push(`${row.raceKey}:SETTLEMENT_LINEAGE_MISMATCH:${row.observationId}`);
        continue;
      }
      const current = grouped.get(row.raceKey) ?? [];
      current.push(row);
      grouped.set(row.raceKey, current);
    }
    const settlements: N2EvaluationSettlement[] = [];
    for (const raceKey of requested) {
      const raceRows = grouped.get(raceKey) ?? [];
      if (raceRows.length !== 1) {
        blockers.push(`${raceKey}:CLEAN_PAYOUT_ROW_COUNT_${raceRows.length}`);
        continue;
      }
      const row = raceRows[0];
      if (row.winningSelection == null || !SELECTIONS.has(row.winningSelection)) {
        blockers.push(`${raceKey}:WINNING_SELECTION_INVALID`);
        continue;
      }
      if (!Number.isSafeInteger(row.payoutYen) || (row.payoutYen ?? 0) < 100) {
        blockers.push(`${raceKey}:PAYOUT_INVALID`);
        continue;
      }
      settlements.push({
        canonicalRaceKey: raceKey,
        winningSelection: row.winningSelection,
        payoutYen: row.payoutYen!,
      });
    }
    if (blockers.length > 0 || settlements.length !== requested.length) {
      if (settlements.length !== requested.length) blockers.push(`SETTLEMENT_COUNT:${settlements.length}/${requested.length}`);
      return blocked(blockers, requested.length, 1);
    }
    const ordered = settlements.sort((left, right) => left.canonicalRaceKey.localeCompare(right.canonicalRaceKey));
    const core = {
      readerVersion: N2_EVALUATION_METRICS_SETTLEMENT_READER_VERSION,
      status: "PASS" as const,
      blockers: [] as string[],
      requestedRaceCount: requested.length,
      settlementCount: ordered.length,
      settlements: ordered,
      databaseReadCount: 1,
      databaseWriteCount: 0 as const,
      networkRequestCount: 0 as const,
      sourcePolicy: "canonical_active_clean_normal_trifecta_payout" as const,
    };
    return { ...core, outputDigest: canonicalHash(core) };
  } finally {
    db.close();
  }
}
