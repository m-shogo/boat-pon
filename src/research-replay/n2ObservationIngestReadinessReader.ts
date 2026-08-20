import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { officialVenueCode } from "../domain/officialLinks";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { canonicalRaceKey } from "./identity";
import type { N2ObservationIngestReadinessInput } from "./n2ObservationIngestReadiness";
import { buildOfficialProgramObservationEnvelope } from "./n2OfficialProgramObservation";
import { N2_TRIFECTA_RAW_PARSER_VERSION } from "./n2TrifectaRawCaptureCanary";

export const N2_OBSERVATION_INGEST_READINESS_READER_VERSION = "n2-observation-ingest-readiness-reader-v1";
const CANARY_DAY_COUNT = 7;
const COMPLETE_TRIFECTA_SELECTION_COUNT = 120;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

type RolloutRow = {
  shadow_write_enabled: number;
  operational_gc_enabled: number;
  kill_switch_engaged: number;
};

type OfficialProgramReadinessRow = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string | null;
  sourceFile: string | null;
  rawJson: string | null;
  importedAt: string | null;
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

function canonicalDatabaseTimestamp(value: string): string {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return canonicalUtcTimestamp(normalized);
}

function closeAtUtc(date: string, closeAt: string): string {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(closeAt);
  if (!match) throw new Error("INVALID_CLOSE_AT");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) throw new Error("INVALID_CLOSE_AT");
  const parsed = Date.parse(`${date}T${match[1]}:${match[2]}:${match[3] ?? "00"}+09:00`);
  if (!Number.isFinite(parsed)) throw new Error("INVALID_CLOSE_AT");
  return new Date(parsed).toISOString();
}

function validOfficialProgramReadinessRow(row: OfficialProgramReadinessRow): boolean {
  try {
    assertCanonicalDate(row.date);
    if (!Number.isInteger(row.raceNo) || row.raceNo < 1 || row.raceNo > 12) return false;
    const venueCode = officialVenueCode(row.venue);
    if (venueCode === null) return false;
    const suffix = String(row.raceNo).padStart(2, "0");
    const compact = compactDate(row.date);
    const venueToken = row.venue.trim();
    const labelIdentity = `${compact}-${venueToken}-${suffix}`;
    const codeIdentity = `${compact}-${venueCode}-${suffix}`;
    if (row.raceId !== labelIdentity && row.raceId !== codeIdentity) return false;
    if (!row.sourceFile || row.sourceFile.trim() === "" || !row.rawJson || row.rawJson.trim() === "") return false;
    if (!row.importedAt || row.importedAt.trim() === "" || !row.closeAt || row.closeAt.trim() === "") return false;
    const sourceObservedAt = canonicalDatabaseTimestamp(row.importedAt);
    const decisionCutoff = closeAtUtc(row.date, row.closeAt);
    if (Date.parse(sourceObservedAt) >= Date.parse(decisionCutoff)) return false;
    buildOfficialProgramObservationEnvelope({
      canonicalRaceKey: canonicalRaceKey(row.date, venueCode, row.raceNo),
      rawJson: row.rawJson,
      sourcePublishedAt: null,
      sourceObservedAt,
      firstSeenAt: sourceObservedAt,
    });
    return true;
  } catch {
    return false;
  }
}

function readOfficialProgramCounts(primary: DatabaseSync, dateFrom: string, dateTo: string): N2ObservationIngestReadinessInput["primaryOfficialProgram"] {
  assertOfficialProgramCohortDates(primary, dateFrom, dateTo);
  const row = primary.prepare(`
    SELECT
      COUNT(*) totalRows,
      SUM(CASE WHEN raw_json IS NULL OR LENGTH(TRIM(raw_json))=0 THEN 1 ELSE 0 END) missingRawJson,
      SUM(CASE WHEN source_file IS NULL OR LENGTH(TRIM(source_file))=0 THEN 1 ELSE 0 END) missingSourceFile,
      SUM(CASE WHEN imported_at IS NULL OR LENGTH(TRIM(imported_at))=0 THEN 1 ELSE 0 END) missingImportedAt,
      SUM(CASE WHEN close_at IS NULL OR LENGTH(TRIM(close_at))=0 THEN 1 ELSE 0 END) missingCloseAt
    FROM official_programs
    WHERE date >= ? AND date <= ?
  `).get(dateFrom, dateTo) as unknown as Record<string, number>;
  const readinessRows = primary.prepare(`
    SELECT
      race_id AS raceId,
      date,
      venue,
      race_no AS raceNo,
      close_at AS closeAt,
      source_file AS sourceFile,
      raw_json AS rawJson,
      imported_at AS importedAt
    FROM official_programs
    WHERE date >= ? AND date <= ?
  `).all(dateFrom, dateTo) as unknown as OfficialProgramReadinessRow[];
  return {
    totalRows: Number(row.totalRows ?? 0),
    eligibleRows: readinessRows.filter(validOfficialProgramReadinessRow).length,
    missingRawJson: Number(row.missingRawJson ?? 0),
    missingSourceFile: Number(row.missingSourceFile ?? 0),
    missingImportedAt: Number(row.missingImportedAt ?? 0),
    missingCloseAt: Number(row.missingCloseAt ?? 0),
  };
}

function selectOddsSourceTable(primary: DatabaseSync): string | null {
  for (const candidate of ["trifecta_market_raw_snapshots", "odds_timeseries_snapshots", "odds_timeseries"]) {
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

function validMarketSnapshotLineage(raceId: string, capturedAt: string): boolean {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})-(\d{2})$/.exec(raceId);
  if (!match) return false;
  const raceDate = `${match[1]}-${match[2]}-${match[3]}`;
  try {
    canonicalRaceKey(raceDate, match[4], Number(match[5]));
    const canonicalCapturedAt = canonicalUtcTimestamp(capturedAt);
    const capturedJstDate = new Date(new Date(canonicalCapturedAt).getTime() + JST_OFFSET_MS)
      .toISOString()
      .slice(0, 10);
    return capturedJstDate === raceDate;
  } catch {
    return false;
  }
}

function rawPayloadDigestMatches(payload: unknown, digest: unknown): boolean {
  if (typeof payload !== "string" || payload.trim() === "" || typeof digest !== "string") return false;
  const normalizedDigest = digest.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedDigest)) return false;
  return createHash("sha256").update(payload, "utf8").digest("hex") === normalizedDigest;
}

function parseRunIdMatches(rawDocumentId: unknown, parseRunId: unknown): boolean {
  if (typeof rawDocumentId !== "string" || rawDocumentId.trim() === "" || rawDocumentId !== rawDocumentId.trim()) return false;
  if (typeof parseRunId !== "string" || parseRunId.trim() === "" || parseRunId !== parseRunId.trim()) return false;
  const expected = `parse-${canonicalHash({
    rawDocumentId,
    parserVersion: N2_TRIFECTA_RAW_PARSER_VERSION,
  }).slice(0, 40)}`;
  return parseRunId === expected;
}

function snapshotHasVerifiedRawLineage(input: {
  primary: DatabaseSync;
  quotedTable: string;
  rawPayloadColumn: string | null;
  rawPayloadDigestColumn: string | null;
  hasRawLineageSchema: boolean;
  hasCheckpoint: boolean;
  raceId: string;
  capturedAt: string;
  checkpointLabel?: string;
}): boolean {
  if (!input.hasRawLineageSchema || !input.rawPayloadColumn || !input.rawPayloadDigestColumn) return false;
  const checkpointClause = input.hasCheckpoint ? " AND checkpoint_label=?" : "";
  const args: Array<string> = [input.raceId, input.capturedAt];
  if (input.hasCheckpoint) {
    if (!input.checkpointLabel) return false;
    args.push(input.checkpointLabel);
  }
  const rows = input.primary.prepare(`
    SELECT
      raw_document_id AS rawDocumentId,
      "${input.rawPayloadColumn}" AS rawPayload,
      "${input.rawPayloadDigestColumn}" AS rawPayloadDigest,
      parse_run_id AS parseRunId,
      source_url AS sourceUrl
    FROM ${input.quotedTable}
    WHERE race_id=? AND captured_at=?${checkpointClause}
      AND bet_type='trifecta' AND odds>0
      AND ${VALID_TRIFECTA_SELECTION_SQL}
  `).all(...args) as unknown as Array<{
    rawDocumentId: string | null;
    rawPayload: unknown;
    rawPayloadDigest: string | null;
    parseRunId: string | null;
    sourceUrl: string | null;
  }>;
  if (rows.length !== COMPLETE_TRIFECTA_SELECTION_COUNT || !rows.every((row) => (
    rawPayloadDigestMatches(row.rawPayload, row.rawPayloadDigest)
      && parseRunIdMatches(row.rawDocumentId, row.parseRunId)
      && typeof row.sourceUrl === "string"
      && row.sourceUrl.trim() !== ""
      && row.sourceUrl === row.sourceUrl.trim()
  ))) {
    return false;
  }
  return new Set(rows.map((row) => row.rawDocumentId)).size === 1
    && new Set(rows.map((row) => row.rawPayloadDigest?.trim().toLowerCase())).size === 1
    && new Set(rows.map((row) => row.parseRunId)).size === 1
    && new Set(rows.map((row) => row.sourceUrl)).size === 1;
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
      rawLineageCompleteSnapshotCount: 0,
      rawDocumentIdColumnPresent: false,
      rawPayloadColumnPresent: false,
      rawPayloadDigestColumnPresent: false,
      parseRunIdColumnPresent: false,
      sourceUrlColumnPresent: false,
    };
  }
  const columns = tableColumns(primary, table);
  const rawPayloadColumn = ["raw_payload", "raw_json", "response_body"].find((column) => columns.includes(column)) ?? null;
  const rawPayloadDigestColumn = ["raw_payload_digest", "payload_sha256", "raw_sha256"].find((column) => columns.includes(column)) ?? null;
  const hasRawLineageSchema = columns.includes("raw_document_id")
    && rawPayloadColumn !== null
    && rawPayloadDigestColumn !== null
    && columns.includes("parse_run_id")
    && columns.includes("source_url");
  const required = ["race_id", "bet_type", "bet_selection", "odds", "captured_at"];
  if (required.some((column) => !columns.includes(column))) {
    return {
      sourceTablePresent: true,
      totalRows: 0,
      raceCount: 0,
      validTimingRows: 0,
      validSelectionRows: 0,
      completeSnapshotCount: 0,
      rawLineageCompleteSnapshotCount: 0,
      rawDocumentIdColumnPresent: columns.includes("raw_document_id"),
      rawPayloadColumnPresent: rawPayloadColumn !== null,
      rawPayloadDigestColumnPresent: rawPayloadDigestColumn !== null,
      parseRunIdColumnPresent: columns.includes("parse_run_id"),
      sourceUrlColumnPresent: columns.includes("source_url"),
    };
  }
  const quoted = `"${table.replaceAll('"', '""')}"`;
  const fromCompact = compactDate(dateFrom);
  const toCompact = compactDate(dateTo);
  const hasCheckpoint = columns.includes("checkpoint_label");
  const checkpointValid = hasCheckpoint
    ? "checkpoint_label IN ('T-30','T-20','T-10','T-5','ad-hoc')"
    : "0=1";
  const rawLineageValid = hasRawLineageSchema
    ? `raw_document_id IS NOT NULL AND LENGTH(TRIM(raw_document_id))>0
       AND "${rawPayloadColumn}" IS NOT NULL AND LENGTH(TRIM("${rawPayloadColumn}"))>0
       AND "${rawPayloadDigestColumn}" IS NOT NULL AND LENGTH(TRIM("${rawPayloadDigestColumn}"))=64
       AND LOWER(TRIM("${rawPayloadDigestColumn}")) NOT GLOB '*[^0-9a-f]*'
       AND parse_run_id IS NOT NULL AND LENGTH(TRIM(parse_run_id))>0
       AND source_url IS NOT NULL AND LENGTH(TRIM(source_url))>0`
    : "0=1";
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
    SELECT
      race_id AS raceId,
      captured_at AS capturedAt${hasCheckpoint ? ", checkpoint_label AS checkpointLabel" : ""},
      SUM(CASE WHEN ${rawLineageValid} THEN 1 ELSE 0 END) AS rawLineageRows
    FROM ${quoted}
    WHERE SUBSTR(race_id,1,8) >= ? AND SUBSTR(race_id,1,8) <= ?
      AND bet_type='trifecta' AND odds>0
      AND ${VALID_TRIFECTA_SELECTION_SQL}
      AND captured_at IS NOT NULL AND LENGTH(TRIM(captured_at))>0
      AND ${checkpointValid}
    GROUP BY race_id, captured_at${hasCheckpoint ? ", checkpoint_label" : ""}
    HAVING COUNT(*)=? AND COUNT(DISTINCT TRIM(bet_selection))=?
  `).all(fromCompact, toCompact, COMPLETE_TRIFECTA_SELECTION_COUNT, COMPLETE_TRIFECTA_SELECTION_COUNT) as unknown as Array<{
    raceId: string;
    capturedAt: string;
    checkpointLabel?: string;
    rawLineageRows: number;
  }>;
  const validSnapshots = completeSnapshotRows.filter((snapshot) => (
    validMarketSnapshotLineage(snapshot.raceId, snapshot.capturedAt)
  ));
  const completeSnapshotCount = validSnapshots.length;
  const rawLineageCompleteSnapshotCount = validSnapshots.filter((snapshot) => (
    Number(snapshot.rawLineageRows) === COMPLETE_TRIFECTA_SELECTION_COUNT
      && snapshotHasVerifiedRawLineage({
        primary,
        quotedTable: quoted,
        rawPayloadColumn,
        rawPayloadDigestColumn,
        hasRawLineageSchema,
        hasCheckpoint,
        raceId: snapshot.raceId,
        capturedAt: snapshot.capturedAt,
        checkpointLabel: snapshot.checkpointLabel,
      })
  )).length;

  return {
    sourceTablePresent: true,
    totalRows: Number(row.totalRows ?? 0),
    raceCount: Number(row.raceCount ?? 0),
    validTimingRows: Number(row.validTimingRows ?? 0),
    validSelectionRows: Number(row.validSelectionRows ?? 0),
    completeSnapshotCount,
    rawLineageCompleteSnapshotCount,
    rawDocumentIdColumnPresent: columns.includes("raw_document_id"),
    rawPayloadColumnPresent: rawPayloadColumn !== null,
    rawPayloadDigestColumnPresent: rawPayloadDigestColumn !== null,
    parseRunIdColumnPresent: columns.includes("parse_run_id"),
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
