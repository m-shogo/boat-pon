import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { canonicalUtcTimestamp } from "./canonical";
import { canonicalRaceKey } from "./identity";
import type { N2TrifectaMarketSourceInventory } from "./n2TrifectaMarketFoundation";

export const N2_TRIFECTA_MARKET_SOURCE_INVENTORY_READER_VERSION = "n2-trifecta-market-source-inventory-reader-v1";
const COHORT_DAY_COUNT = 7;
const COMPLETE_SELECTION_COUNT = 120;

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

function validMarketRaceId(value: string): boolean {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const venueCode = match[4];
  const raceNo = Number(match[5]);
  try {
    canonicalRaceKey(date, venueCode, raceNo);
    return true;
  } catch {
    return false;
  }
}

function assertQuiescent(path: string): void {
  if (!existsSync(path)) throw new Error("PRIMARY_DB_NOT_FOUND");
  const walPath = `${path}-wal`;
  if (existsSync(walPath) && statSync(walPath).size > 0) throw new Error("PRIMARY_DB_ACTIVE_WAL");
}

function openImmutable(path: string): DatabaseSync {
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
  return db;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as unknown as Array<{ name: string }>)
    .map((row) => row.name)
    .sort();
}

function selectSourceTable(db: DatabaseSync): string | null {
  for (const candidate of ["trifecta_market_raw_snapshots", "odds_timeseries_snapshots", "odds_timeseries"]) {
    if (tableExists(db, candidate)) return candidate;
  }
  return null;
}

function latestProgramDate(db: DatabaseSync): string {
  if (!tableExists(db, "official_programs")) throw new Error("OFFICIAL_PROGRAMS_TABLE_MISSING");
  const row = db.prepare("SELECT MAX(date) dateTo FROM official_programs").get() as unknown as { dateTo: string | null };
  if (!row.dateTo || !/^\d{4}-\d{2}-\d{2}$/.test(row.dateTo)) throw new Error("OFFICIAL_PROGRAMS_EMPTY");
  try {
    const canonicalDate = canonicalUtcTimestamp(`${row.dateTo}T00:00:00.000Z`).slice(0, 10);
    if (canonicalDate !== row.dateTo) throw new Error("OFFICIAL_PROGRAM_DATE_INVALID");
  } catch {
    throw new Error("OFFICIAL_PROGRAM_DATE_INVALID");
  }
  return row.dateTo;
}

function subtractUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("INVALID_COHORT_DATE");
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

function hasAny(columns: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => columns.includes(candidate));
}

function emptyInventory(dateFrom: string, dateTo: string): N2TrifectaMarketSourceInventory {
  return {
    readerVersion: N2_TRIFECTA_MARKET_SOURCE_INVENTORY_READER_VERSION,
    cohort: { dateFrom, dateTo, dayCount: COHORT_DAY_COUNT },
    sourceTable: null,
    sourceTablePresent: false,
    columns: [],
    totalRows: 0,
    raceCount: 0,
    checkpointCount: 0,
    completeSnapshotCount: 0,
    rawDocumentIdColumnPresent: false,
    rawPayloadColumnPresent: false,
    rawPayloadDigestColumnPresent: false,
    parseRunIdColumnPresent: false,
    sourceUrlColumnPresent: false,
    capturedAtColumnPresent: false,
    availableAtColumnPresent: false,
    decisionCutoffColumnPresent: false,
    checkpointLabelColumnPresent: false,
  };
}

export function readN2TrifectaMarketSourceInventory(input: {
  primaryDbPath: string;
}): N2TrifectaMarketSourceInventory {
  assertQuiescent(input.primaryDbPath);
  const db = openImmutable(input.primaryDbPath);
  try {
    const dateTo = latestProgramDate(db);
    const dateFrom = subtractUtcDays(dateTo, COHORT_DAY_COUNT - 1);
    const sourceTable = selectSourceTable(db);
    if (!sourceTable) return emptyInventory(dateFrom, dateTo);

    const columns = tableColumns(db, sourceTable);
    const inventory: N2TrifectaMarketSourceInventory = {
      ...emptyInventory(dateFrom, dateTo),
      sourceTable,
      sourceTablePresent: true,
      columns,
      rawDocumentIdColumnPresent: columns.includes("raw_document_id"),
      rawPayloadColumnPresent: hasAny(columns, ["raw_payload", "raw_json", "response_body"]),
      rawPayloadDigestColumnPresent: hasAny(columns, ["raw_payload_digest", "payload_sha256", "raw_sha256"]),
      parseRunIdColumnPresent: columns.includes("parse_run_id"),
      sourceUrlColumnPresent: columns.includes("source_url"),
      capturedAtColumnPresent: columns.includes("captured_at"),
      availableAtColumnPresent: columns.includes("available_at"),
      decisionCutoffColumnPresent: columns.includes("decision_cutoff"),
      checkpointLabelColumnPresent: columns.includes("checkpoint_label"),
    };

    const required = ["race_id", "bet_type", "bet_selection", "odds", "captured_at"];
    if (required.some((column) => !columns.includes(column))) return inventory;

    const table = quoteIdentifier(sourceTable);
    const fromCompact = compactDate(dateFrom);
    const toCompact = compactDate(dateTo);
    const checkpointExpression = columns.includes("checkpoint_label")
      ? "checkpoint_label"
      : "captured_at";
    const counts = db.prepare(`
      SELECT
        COUNT(*) totalRows,
        COUNT(DISTINCT race_id) raceCount,
        COUNT(DISTINCT race_id || '|' || COALESCE(${checkpointExpression}, '')) checkpointCount
      FROM ${table}
      WHERE SUBSTR(race_id, 1, 8) >= ?
        AND SUBSTR(race_id, 1, 8) <= ?
        AND bet_type='trifecta'
    `).get(fromCompact, toCompact) as unknown as Record<string, number>;

    const groupColumns = columns.includes("checkpoint_label")
      ? "race_id, checkpoint_label, captured_at"
      : "race_id, captured_at";
    const completeSnapshotRows = db.prepare(`
      SELECT race_id AS raceId, captured_at AS capturedAt FROM (
        SELECT ${groupColumns}
        FROM ${table}
        WHERE SUBSTR(race_id, 1, 8) >= ?
          AND SUBSTR(race_id, 1, 8) <= ?
          AND bet_type='trifecta'
          AND captured_at IS NOT NULL
          AND LENGTH(TRIM(captured_at)) > 0
          AND ${VALID_TRIFECTA_SELECTION_SQL}
          AND odds > 0
        GROUP BY ${groupColumns}
        HAVING COUNT(*)=? AND COUNT(DISTINCT TRIM(bet_selection))=?
      )
    `).all(fromCompact, toCompact, COMPLETE_SELECTION_COUNT, COMPLETE_SELECTION_COUNT) as unknown as Array<{
      raceId: string;
      capturedAt: string;
    }>;
    const completeSnapshotCount = completeSnapshotRows.filter((row) => (
      validMarketRaceId(row.raceId) && validMarketCapturedAt(row.capturedAt)
    )).length;

    return {
      ...inventory,
      totalRows: Number(counts.totalRows ?? 0),
      raceCount: Number(counts.raceCount ?? 0),
      checkpointCount: Number(counts.checkpointCount ?? 0),
      completeSnapshotCount,
    };
  } finally {
    db.close();
  }
}