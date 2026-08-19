import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type {
  OfficialProgramCanaryCohort,
  OfficialProgramCanarySourceRow,
} from "./n2OfficialProgramCanary";

export const N2_OFFICIAL_PROGRAM_CANARY_READER_VERSION = "n2-official-program-canary-reader-v1";
export const N2_OFFICIAL_PROGRAM_CANARY_COHORT_DAYS = 7;
export const N2_OFFICIAL_PROGRAM_CANARY_SOURCE_READ_LIMIT = 5_000;

export type OfficialProgramCanaryReadResult = {
  rows: OfficialProgramCanarySourceRow[];
  cohort: OfficialProgramCanaryCohort;
  returnedRowCount: number;
  truncated: boolean;
  readOnly: true;
  queryOnly: true;
  primaryWriteCount: 0;
  sourceTable: "official_programs";
  readerVersion: typeof N2_OFFICIAL_PROGRAM_CANARY_READER_VERSION;
};

function assertQuiescent(path: string): void {
  if (!existsSync(path)) throw new Error("PRIMARY_DB_NOT_FOUND");
  const wal = `${path}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) throw new Error("PRIMARY_DB_ACTIVE_WAL");
}

function openImmutable(path: string): DatabaseSync {
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
  return db;
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function requiredColumnsPresent(db: DatabaseSync): boolean {
  const columns = (db.prepare("PRAGMA table_info(official_programs)").all() as unknown as Array<{ name: string }>)
    .map((row) => row.name);
  return ["race_id", "date", "venue", "race_no", "close_at", "source_file", "raw_json", "imported_at"]
    .every((column) => columns.includes(column));
}

function assertCanonicalDate(date: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("INVALID_PRIMARY_MAX_DATE");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error("INVALID_PRIMARY_MAX_DATE");
  }
}

function subtractUtcDays(date: string, days: number): string {
  assertCanonicalDate(date);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

export function readOfficialProgramCanarySource(input: {
  primaryDbPath: string;
  limit?: number;
}): OfficialProgramCanaryReadResult {
  const limit = input.limit ?? N2_OFFICIAL_PROGRAM_CANARY_SOURCE_READ_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > N2_OFFICIAL_PROGRAM_CANARY_SOURCE_READ_LIMIT) {
    throw new Error(`INVALID_CANARY_SOURCE_LIMIT:${limit}`);
  }
  assertQuiescent(input.primaryDbPath);
  const primary = openImmutable(input.primaryDbPath);
  try {
    if (!tableExists(primary, "official_programs")) throw new Error("OFFICIAL_PROGRAMS_TABLE_MISSING");
    if (!requiredColumnsPresent(primary)) throw new Error("OFFICIAL_PROGRAMS_SCHEMA_MISMATCH");
    const latest = primary.prepare("SELECT MAX(date) maxDate FROM official_programs").get() as unknown as {
      maxDate: string | null;
    };
    if (!latest.maxDate) throw new Error("OFFICIAL_PROGRAMS_EMPTY");
    assertCanonicalDate(latest.maxDate);
    const cohort: OfficialProgramCanaryCohort = {
      dateFrom: subtractUtcDays(latest.maxDate, N2_OFFICIAL_PROGRAM_CANARY_COHORT_DAYS - 1),
      dateTo: latest.maxDate,
    };
    const sourceRows = primary.prepare(`
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
      ORDER BY date, venue, race_no, race_id
      LIMIT ?
    `).all(cohort.dateFrom, cohort.dateTo, limit + 1) as unknown as OfficialProgramCanarySourceRow[];
    const truncated = sourceRows.length > limit;
    const rows = truncated ? sourceRows.slice(0, limit) : sourceRows;
    return {
      rows,
      cohort,
      returnedRowCount: rows.length,
      truncated,
      readOnly: true,
      queryOnly: true,
      primaryWriteCount: 0,
      sourceTable: "official_programs",
      readerVersion: N2_OFFICIAL_PROGRAM_CANARY_READER_VERSION,
    };
  } finally {
    primary.close();
  }
}