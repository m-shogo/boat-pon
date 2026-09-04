import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { officialVenueCode } from "../domain/officialLinks";
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

type OfficialProgramIdentityRow = Pick<
  OfficialProgramCanarySourceRow,
  "raceId" | "date" | "venue" | "raceNo"
>;

type CanonicalIdentityRow = OfficialProgramIdentityRow & {
  canonicalVenueCode: string;
  canonicalRaceKey: string;
};

function assertQuiescent(path: string): string {
  if (!existsSync(path)) throw new Error("PRIMARY_DB_NOT_FOUND");
  const lexicalPath = resolve(path);
  const lstat = lstatSync(lexicalPath);
  if (lstat.isSymbolicLink() || !lstat.isFile()) throw new Error("PRIMARY_DB_IDENTITY_INVALID");
  const stat = statSync(lexicalPath);
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(lexicalPath) !== lexicalPath) {
    throw new Error("PRIMARY_DB_IDENTITY_INVALID");
  }
  const wal = `${lexicalPath}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) throw new Error("PRIMARY_DB_ACTIVE_WAL");
  return lexicalPath;
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

function canonicalizeIdentityRow(row: OfficialProgramIdentityRow): CanonicalIdentityRow {
  if (!isCanonicalDate(row.date)) throw new Error(`INVALID_PRIMARY_RACE_DATE:${row.raceId}`);
  if (!Number.isInteger(row.raceNo) || row.raceNo < 1 || row.raceNo > 12) {
    throw new Error(`INVALID_PRIMARY_RACE_NUMBER:${row.raceId}`);
  }
  const canonicalVenueCode = officialVenueCode(row.venue);
  if (canonicalVenueCode === null) throw new Error(`INVALID_PRIMARY_VENUE:${row.raceId}`);
  return {
    ...row,
    canonicalVenueCode,
    canonicalRaceKey: `${row.date}:${canonicalVenueCode}:R${row.raceNo}`,
  };
}

function isCanonicalDate(date: string): boolean {
  try {
    assertCanonicalDate(date);
    return true;
  } catch {
    return false;
  }
}

function canonicalIdentityRows(rows: OfficialProgramIdentityRow[]): CanonicalIdentityRow[] {
  const canonicalRows = rows.map(canonicalizeIdentityRow);
  const seen = new Set<string>();
  for (const row of canonicalRows) {
    if (seen.has(row.canonicalRaceKey)) {
      throw new Error(`DUPLICATE_CANONICAL_RACE:${row.canonicalRaceKey}`);
    }
    seen.add(row.canonicalRaceKey);
  }
  return canonicalRows.sort((left, right) =>
    left.date.localeCompare(right.date)
    || left.canonicalVenueCode.localeCompare(right.canonicalVenueCode)
    || left.raceNo - right.raceNo
    || left.raceId.localeCompare(right.raceId));
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
  const primaryPath = assertQuiescent(input.primaryDbPath);
  const primary = openImmutable(primaryPath);
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

    const identityRows = primary.prepare(`
      SELECT race_id AS raceId, date, venue, race_no AS raceNo
      FROM official_programs
      WHERE date >= ? AND date <= ?
      LIMIT ?
    `).all(
      cohort.dateFrom,
      cohort.dateTo,
      N2_OFFICIAL_PROGRAM_CANARY_SOURCE_READ_LIMIT + 1,
    ) as unknown as OfficialProgramIdentityRow[];
    if (identityRows.length > N2_OFFICIAL_PROGRAM_CANARY_SOURCE_READ_LIMIT) {
      throw new Error(`CANARY_SOURCE_COHORT_EXCEEDS_BOUND:${identityRows.length}`);
    }

    const canonicalRows = canonicalIdentityRows(identityRows);
    const truncated = canonicalRows.length > limit;
    const selectedRows = truncated ? canonicalRows.slice(0, limit) : canonicalRows;
    const sourceRowByRaceId = primary.prepare(`
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
      WHERE race_id = ?
    `);
    const rows = selectedRows.map((selected) => {
      const row = sourceRowByRaceId.get(selected.raceId) as unknown as OfficialProgramCanarySourceRow | undefined;
      if (!row) throw new Error(`CANARY_SOURCE_ROW_MISSING:${selected.raceId}`);
      return row;
    });
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
