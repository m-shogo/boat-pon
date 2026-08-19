import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { canonicalUtcTimestamp } from "./canonical";
import type { N2ObservationIngestReadinessInput } from "./n2ObservationIngestReadiness";

export const N2_OBSERVATION_INGEST_READINESS_READER_VERSION = "n2-observation-ingest-readiness-reader-v1";
const CANARY_DAY_COUNT = 7;
const COMPLETE_TRIFECTA_SELECTION_COUNT = 120;

type RolloutRow = {
  shadow_write_enabled: number;
  operational_gc_enabled: number;
  kill_switch_engaged: number;
};

export type N2ObservationIngestReadinessReadResult = {
  input: N2ObservationIngestReadinessInput;
  sourceIdentity: {
    oddsSourceTable: string | null;
    readerVersion: typeof N2_OBSERVATION_INGEST_READINESS_READER_VERSION;
  };
};

function assertQuiescent(path: string, label: string): void {
  if (!existsSync(path)) throw new Error(`${label}_NOT_FOUND`);
  const wal = `${path}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) throw new Error(`${label}_ACTIVE_WAL`);
}

function openImmutable(path: string): DatabaseSync {
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
  return db;
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return (db.prepare(`PRAGMA table_info(${quoted})`).all() as unknown as Array<{ name: string }>).map((row) => row.name);
}

function countTable(db: DatabaseSync, table: string): number {
  if (!tableExists(db, table)) return 0;
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return Number((db.prepare(`SELECT COUNT(*) n FROM ${quoted}`).get() as unknown as { n: number }).n);
}

function assertCanonicalDate(date: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("N2_READINESS_INVALID_MAX_DATE");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error("N2_READINESS_INVALID_MAX_DATE");
  }
}

function subtractUtcDays(date: string, days: number): string {
  assertCanonicalDate(date);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

function latestProgramDate(primary: DatabaseSync): string {
  if (!tableExists(primary, "official_programs")) throw new Error("N2_READINESS_OFFICIAL_PROGRAMS_TABLE_MISSING");
  const row = primary.prepare("SELECT MAX(date) maxDate FROM official_programs").get() as unknown as { maxDate: string | null };
  if (!row.maxDate) throw new Error("N2_READINESS_OFFICIAL_PROGRAMS_EMPTY");
  assertCanonicalDate(row.maxDate);
  return row.maxDate;
}

function assertOfficialProgramCohortDates(primary: DatabaseSync, dateFrom: string, dateTo: string): void {
  const rows = primary.prepare(`
    SELECT DISTINCT date
    FROM official_programs
    WHERE date >= ? AND date <= ?
    ORDER BY date
  `).all(dateFrom, dateTo) as unknown as Array<{ date: string }>;
  for (const row of rows) assertCanonicalDate(row.date);
}

function readOfficialProgramCounts(primary: DatabaseSync, dateFrom: string, dateTo: string): N2ObservationIngestReadinessInput["primaryOfficialProgram"] {
  assertOfficialProgramCohortDates(primary, dateFrom, dateTo);
  const row = primary.prepare(`
    SELECT
      COUNT(*) totalRows,
      SUM(CASE WHEN raw_json IS NULL OR LENGTH(TRIM(raw_json))=0 THEN 1 ELSE 0 END) missingRawJson,
      SUM(CASE WHEN source_file IS NULL OR LENGTH(TRIM(source_file))=0 THEN 1 ELSE 0 END) missingSourceFile,
      SUM(CASE WHEN imported_at IS NULL OR LENGTH(TRIM(imported_at))=0 THEN 1 ELSE 0 END) missingImportedAt,
      SUM(CASE WHEN close_at IS NULL OR LENGTH(TRIM(close_at))=0 THEN 1 ELSE 0 END) missingCloseAt,
      SUM(CASE WHEN raw_json IS NOT NULL AND LENGTH(TRIM(raw_json))>0
                    AND source_file IS NOT NULL AND LENGTH(TRIM(source_file))>0
                    AND imported_at IS NOT NULL AND LENGTH(TRIM(imported_at))>0
                    AND close_at IS NOT NULL AND LENGTH(TRIM(close_at))>0
               THEN 1 ELSE 0 END) eligibleRows
    FROM official_programs
    WHERE date >= ? AND date <= ?
  `).get(dateFrom, dateTo) as unknown as Record<string, number>;
  return {
    totalRows: Number(row.totalRows ?? 0),
    eligibleRows: Number(row.eligibleRows ?? 0),
    missingRawJson: Number(row.missingRawJson ?? 0),
    missingSourceFile: Number(row.missingSourceFile ?? 0),
    missingImportedAt: Number(row.missingImportedAt ?? 0),
    missingCloseAt: Number(row.missingCloseAt ?? 0),
  };
}

function selectOddsSourceTable(primary: DatabaseSync): string | null {
  for (const candidate of ["odds_timeseries_snapshots", "odds_timeseries"]) {
    if (tableExists(primary, candidate)) return candidate;
  }
  return null;
}

const VALID_TRIFECTA_SELECTION_SQL = `
  bet_selection IS NOT NULL
  AND LENGTH(TRIM(bet_selection))=3
  AND SUBSTR(TRIM(bet_selection),1,1) BETWEEN '1' AND '6'
  AND SUBSTR(TRIM(bet_selection),2,1) BETWEEN '1' AND '6'
  AND SUBSTR(TRIM(bet_selection),3,1) BETWEEN '1' AND '6'
  AND SUBSTR(TRIM(bet_selection),1,1) <> SUBSTR(TRIM(bet_selection),2,1)
  AND SUBSTR(TRIM(bet_selection),1,1) <> SUBSTR(TRIM(bet_selection),3,1)
  AND SUBSTR(TRIM(bet_selection),2,1) <> SUBSTR(TRIM(bet_selection),3,1)
`;

function validMarketCapturedAt(value: string): boolean {
  try {
    canonicalUtcTimestamp(value);
    return true;
  } catch {
    return false;
  }
}

function readTrifectaMarketCounts(
  primary: DatabaseSync,
  table: string | null,
  dateFrom: string,
  dateTo: string,
): N2ObservationIngestReadinessInput["primaryTrifectaMarket"] {
  if (!table) {
    return {
      sourceTablePresent: false,
      totalRows: 0,
      raceCount: 0,
      validTimingRows: 0,
      validSelectionRows: 0,
      completeSnapshotCount: 0,
      rawDocumentIdColumnPresent: false,
      rawPayloadColumnPresent: false,
      sourceUrlColumnPresent: false,
    };
  }
  const columns = tableColumns(primary, table);
  const required = ["race_id", "bet_type", "bet_selection", "odds", "captured_at"];
  if (required.some((column) => !columns.includes(column))) {
    return {
      sourceTablePresent: true,
      totalRows: 0,
      raceCount: 0,
      validTimingRows: 0,
      validSelectionRows: 0,
      completeSnapshotCount: 0,
      rawDocumentIdColumnPresent: columns.includes("raw_document_id"),
      rawPayloadColumnPresent: columns.some((column) => ["raw_json", "raw_payload", "response_body"].includes(column)),
      sourceUrlColumnPresent: columns.includes("source_url"),
    };
  }
  const quoted = `"${table.replaceAll('"', '""')}"`;
  const fromCompact = compactDate(dateFrom);
  const toCompact = compactDate(dateTo);
  const hasCheckpoint = columns.includes("checkpoint_label");
  const checkpointValid = hasCheckpoint
    ? "checkpoint_label IN ('T-30','T-20','T-10','T-5','ad-hoc')"
    : "1=1";
  const row = primary.prepare(`
    SELECT
      COUNT(*) totalRows,
      COUNT(DISTINCT race_id) raceCount,
      SUM(CASE WHEN captured_at IS NOT NULL AND LENGTH(TRIM(captured_at))>0 AND ${checkpointValid} THEN 1 ELSE 0 END) validTimingRows,
      SUM(CASE WHEN ${VALID_TRIFECTA_SELECTION_SQL} AND odds>0 THEN 1 ELSE 0 END) validSelectionRows
    FROM ${quoted}
    WHERE SUBSTR(race_id,1,8) >= ? AND SUBSTR(race_id,1,8) <= ? AND bet_type='trifecta'
  `).get(fromCompact, toCompact) as unknown as Record<string, number>;

  const completeSnapshotRows = primary.prepare(`
    SELECT race_id AS raceId, captured_at AS capturedAt${hasCheckpoint ? ", checkpoint_label AS checkpointLabel" : ""}
    FROM ${quoted}
    WHERE SUBSTR(race_id,1,8) >= ? AND SUBSTR(race_id,1,8) <= ?
      AND bet_type='trifecta' AND odds>0
      AND ${VALID_TRIFECTA_SELECTION_SQL}
      AND captured_at IS NOT NULL AND LENGTH(TRIM(captured_at))>0
      ${hasCheckpoint ? "AND checkpoint_label IN ('T-30','T-20','T-10','T-5','ad-hoc')" : ""}
    GROUP BY race_id, captured_at${hasCheckpoint ? ", checkpoint_label" : ""}
    HAVING COUNT(*)=? AND COUNT(DISTINCT TRIM(bet_selection))=?
  `).all(fromCompact, toCompact, COMPLETE_TRIFECTA_SELECTION_COUNT, COMPLETE_TRIFECTA_SELECTION_COUNT) as unknown as Array<{
    raceId: string;
    capturedAt: string;
    checkpointLabel?: string;
  }>;
  const completeSnapshotCount = completeSnapshotRows.filter((snapshot) => validMarketCapturedAt(snapshot.capturedAt)).length;

  return {
    sourceTablePresent: true,
    totalRows: Number(row.totalRows ?? 0),
    raceCount: Number(row.raceCount ?? 0),
    validTimingRows: Number(row.validTimingRows ?? 0),
    validSelectionRows: Number(row.validSelectionRows ?? 0),
    completeSnapshotCount,
    rawDocumentIdColumnPresent: columns.includes("raw_document_id"),
    rawPayloadColumnPresent: columns.some((column) => ["raw_json", "raw_payload", "response_body"].includes(column)),
    sourceUrlColumnPresent: columns.includes("source_url"),
  };
}

function observationCount(sidecar: DatabaseSync, observationType: string): number {
  if (!tableExists(sidecar, "domain_observations")) return 0;
  return Number((sidecar.prepare("SELECT COUNT(*) n FROM domain_observations WHERE observation_type=?")
    .get(observationType) as unknown as { n: number }).n);
}

function latestRollout(sidecar: DatabaseSync): N2ObservationIngestReadinessInput["rollout"] {
  let row: RolloutRow | undefined;
  if (tableExists(sidecar, "rollout_config_events")) {
    row = sidecar.prepare(`
      SELECT shadow_write_enabled, operational_gc_enabled, kill_switch_engaged
      FROM rollout_config_events ORDER BY occurred_at DESC, rowid DESC LIMIT 1
    `).get() as unknown as RolloutRow | undefined;
  }

  let approvalScopes: string[] = [];
  if (tableExists(sidecar, "rollout_approval_grants_v2")) {
    const rows = sidecar.prepare(
      "SELECT DISTINCT approval_scope FROM rollout_approval_grants_v2 ORDER BY approval_scope",
    ).all() as unknown as Array<{ approval_scope: string }>;
    approvalScopes = rows.map((item) => item.approval_scope);
  }

  return {
    shadowWriteEnabled: Boolean(row?.shadow_write_enabled),
    operationalGcEnabled: Boolean(row?.operational_gc_enabled),
    killSwitchEngaged: Boolean(row?.kill_switch_engaged),
    approvalScopes,
  };
}

export function readN2ObservationIngestReadiness(input: {
  primaryDbPath: string;
  sidecarDbPath: string;
}): N2ObservationIngestReadinessReadResult {
  assertQuiescent(input.primaryDbPath, "PRIMARY_DB");
  assertQuiescent(input.sidecarDbPath, "SIDECAR");
  const primary = openImmutable(input.primaryDbPath);
  const sidecar = openImmutable(input.sidecarDbPath);
  try {
    const dateTo = latestProgramDate(primary);
    const dateFrom = subtractUtcDays(dateTo, CANARY_DAY_COUNT - 1);
    const oddsSourceTable = selectOddsSourceTable(primary);
    return {
      input: {
        cohort: { dateFrom, dateTo, dayCount: CANARY_DAY_COUNT },
        primaryOfficialProgram: readOfficialProgramCounts(primary, dateFrom, dateTo),
        primaryTrifectaMarket: readTrifectaMarketCounts(primary, oddsSourceTable, dateFrom, dateTo),
        sidecar: {
          officialProgramObservationCount: observationCount(sidecar, "official_program"),
          trifectaMarketObservationCount: observationCount(sidecar, "trifecta_market"),
          captureAttemptCount: countTable(sidecar, "capture_attempts"),
          outboxMessageCount: countTable(sidecar, "shadow_outbox_messages"),
          deliveryAttemptCount: countTable(sidecar, "shadow_delivery_attempts"),
        },
        rollout: latestRollout(sidecar),
        wiring: {
          officialProgramCaptureImplemented: true,
          officialProgramProductionCallerConnected: false,
          trifectaMarketWriterImplemented: false,
        },
      },
      sourceIdentity: {
        oddsSourceTable,
        readerVersion: N2_OBSERVATION_INGEST_READINESS_READER_VERSION,
      },
    };
  } finally {
    sidecar.close();
    primary.close();
  }
}
