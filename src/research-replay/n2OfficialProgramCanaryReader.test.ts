import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readOfficialProgramCanarySource } from "./n2OfficialProgramCanaryReader";

function createPrimary(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      venue TEXT NOT NULL,
      race_no INTEGER NOT NULL,
      close_at TEXT NOT NULL,
      source_file TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
  `);
  return db;
}

function insertRow(db: DatabaseSync, input: {
  raceId: string;
  date: string;
  venue?: string;
  raceNo?: number;
  importedAt?: string;
}) {
  db.prepare(`
    INSERT INTO official_programs
    (race_id, date, venue, race_no, close_at, source_file, raw_json, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.raceId,
    input.date,
    input.venue ?? "桐生",
    input.raceNo ?? 1,
    "12:00",
    `/cache/${input.raceId}.json`,
    JSON.stringify({ boats: [] }),
    input.importedAt ?? `${input.date} 01:00:00`,
  );
}

test("reader selects the latest seven-day cohort deterministically without writing primary", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-program-canary-reader-"));
  const path = join(dir, "primary.sqlite");
  const db = createPrimary(path);
  try {
    insertRow(db, { raceId: "20040101-01-01", date: "2004-01-01" });
    insertRow(db, { raceId: "20040110-02-02", date: "2004-01-10", venue: "戸田", raceNo: 2 });
    insertRow(db, { raceId: "20040109-01-03", date: "2004-01-09", raceNo: 3 });
  } finally {
    db.close();
  }
  const before = statSync(path);
  try {
    const result = readOfficialProgramCanarySource({ primaryDbPath: path });
    assert.deepEqual(result.cohort, { dateFrom: "2004-01-04", dateTo: "2004-01-10" });
    assert.equal(result.returnedRowCount, 2);
    assert.equal(result.truncated, false);
    assert.equal(result.readOnly, true);
    assert.equal(result.queryOnly, true);
    assert.equal(result.primaryWriteCount, 0);
    assert.deepEqual(result.rows.map((row) => row.raceId), [
      "20040109-01-03",
      "20040110-02-02",
    ]);
    const after = statSync(path);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reader reports deterministic truncation and rejects invalid limits", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-program-canary-reader-limit-"));
  const path = join(dir, "primary.sqlite");
  const db = createPrimary(path);
  try {
    insertRow(db, { raceId: "20040110-01-01", date: "2004-01-10" });
    insertRow(db, { raceId: "20040110-01-02", date: "2004-01-10", raceNo: 2 });
  } finally {
    db.close();
  }
  try {
    const result = readOfficialProgramCanarySource({ primaryDbPath: path, limit: 1 });
    assert.equal(result.returnedRowCount, 1);
    assert.equal(result.truncated, true);
    assert.equal(result.rows[0].raceId, "20040110-01-01");
    assert.throws(() => readOfficialProgramCanarySource({ primaryDbPath: path, limit: 0 }), /INVALID_CANARY_SOURCE_LIMIT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing schema and an active WAL fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-program-canary-reader-block-"));
  const missingPath = join(dir, "missing-table.sqlite");
  const missing = new DatabaseSync(missingPath);
  missing.exec("CREATE TABLE other (id INTEGER)");
  missing.close();
  assert.throws(() => readOfficialProgramCanarySource({ primaryDbPath: missingPath }), /OFFICIAL_PROGRAMS_TABLE_MISSING/);

  const walPath = join(dir, "active-wal.sqlite");
  const writer = createPrimary(walPath);
  insertRow(writer, { raceId: "20040110-01-01", date: "2004-01-10" });
  writer.close();
  writeFileSync(`${walPath}-wal`, Buffer.from("non-empty-active-wal-fixture"));
  try {
    assert.throws(() => readOfficialProgramCanarySource({ primaryDbPath: walPath }), /PRIMARY_DB_ACTIVE_WAL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
