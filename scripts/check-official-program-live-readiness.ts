import { existsSync, lstatSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

import { summarizeOfficialProgramDayInventory } from "../src/domain/officialProgramRefreshPolicy";

const date = process.argv[2]?.trim() || jstDate(new Date());
const dbPath = resolve(process.env.BOAT_PON_PRIMARY_DB_PATH?.trim() || "data/boat.sqlite");
const maxAgeMinutes = Number(process.env.BOAT_PON_PROGRAM_READINESS_MAX_AGE_MINUTES ?? "180");

if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error("INVALID_READINESS_DATE");
if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0 || maxAgeMinutes > 24 * 60) {
  throw new Error("INVALID_READINESS_MAX_AGE_MINUTES");
}
if (!existsSync(dbPath)) throw new Error("PROGRAM_READINESS_DB_NOT_FOUND");
if (lstatSync(dbPath).isSymbolicLink() || !statSync(dbPath).isFile()) {
  throw new Error("PROGRAM_READINESS_DB_TYPE_INVALID");
}

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  db.exec("PRAGMA query_only = ON;");
  const rows = db.prepare(`
SELECT date, venue, race_no, close_at, imported_at
FROM official_programs
WHERE date = ?
ORDER BY venue, race_no
`).all(date) as Array<{
    date: string;
    venue: string;
    race_no: number;
    close_at: string;
    imported_at: string;
  }>;

  const inventory = summarizeOfficialProgramDayInventory(
    date,
    rows.map((row) => ({ date: row.date, venue: row.venue, raceNo: Number(row.race_no) })),
  );
  const importedInstants = rows
    .map((row) => parseSqliteUtc(row.imported_at))
    .filter((value): value is number => value != null);
  const latestImportedAtMs = importedInstants.length > 0 ? Math.max(...importedInstants) : null;
  const nowMs = Date.now();
  const latestImportAgeMinutes = latestImportedAtMs == null
    ? null
    : Math.max(0, (nowMs - latestImportedAtMs) / 60_000);
  const earliestCloseAt = rows
    .map((row) => row.close_at)
    .filter((value) => /^\d{2}:\d{2}$/u.test(value))
    .sort()[0] ?? null;
  const blockers: string[] = [];
  if (!inventory.structurallyComplete) blockers.push("PROGRAM_INVENTORY_INCOMPLETE");
  if (latestImportAgeMinutes == null) blockers.push("PROGRAM_IMPORTED_AT_MISSING");
  if (latestImportAgeMinutes != null && latestImportAgeMinutes > maxAgeMinutes) {
    blockers.push("PROGRAM_INVENTORY_STALE");
  }
  if (earliestCloseAt == null) blockers.push("PROGRAM_CLOSE_TIME_MISSING");

  const report = {
    reportVersion: "official-program-live-readiness-v1",
    status: blockers.length === 0 ? "PASS" : "BLOCKED",
    blockers,
    checkedAt: new Date(nowMs).toISOString(),
    dateJst: date,
    databaseReadOnly: true,
    databaseWriteCount: 0,
    totalRows: inventory.totalRows,
    venueCount: inventory.venueCount,
    completeVenueCount: inventory.completeVenueCount,
    incompleteVenues: inventory.incompleteVenues,
    earliestCloseAtJst: earliestCloseAt,
    latestImportedAt: latestImportedAtMs == null ? null : new Date(latestImportedAtMs).toISOString(),
    latestImportAgeMinutes,
    maxAllowedImportAgeMinutes: maxAgeMinutes,
  };
  console.log(JSON.stringify(report, null, 2));
  if (blockers.length > 0) process.exitCode = 3;
} finally {
  db.close();
}

function parseSqliteUtc(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)) return null;
  const parsed = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function jstDate(value: Date): string {
  return new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(value);
}
