import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readN2ObservationIngestReadiness } from "./n2ObservationIngestReadinessReader";

function setup(): { root: string; primary: string; sidecar: string } {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-program-semantics-"));
  const primary = join(root, "boat.sqlite");
  const sidecar = join(root, "research-replay.sqlite");
  const db = new DatabaseSync(primary);
  try {
    db.exec(`
      CREATE TABLE official_programs (
        race_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        race_no INTEGER NOT NULL,
        close_at TEXT,
        source_file TEXT,
        raw_json TEXT,
        imported_at TEXT
      );
    `);
    const insert = db.prepare("INSERT INTO official_programs VALUES(?,?,?,?,?,?,?,?)");
    insert.run("20260805-01-01", "2026-08-05", "01", 1, "12:00", "valid.json", "{}", "2026-08-05T00:00:00.000Z");
    insert.run("20260805-01-13", "2026-08-05", "01", 13, "12:00", "r13.json", "{}", "2026-08-05T00:00:00.000Z");
    insert.run("20260805-99-02", "2026-08-05", "99", 2, "12:00", "venue.json", "{}", "2026-08-05T00:00:00.000Z");
    insert.run("20260805-01-09", "2026-08-05", "01", 3, "12:00", "identity.json", "{}", "2026-08-05T00:00:00.000Z");
    insert.run("20260805-01-04", "2026-08-05", "01", 4, "24:00", "close.json", "{}", "2026-08-05T00:00:00.000Z");
    insert.run("20260805-01-05", "2026-08-05", "01", 5, "12:00", "late.json", "{}", "2026-08-05T04:00:00.000Z");
  } finally {
    db.close();
  }
  new DatabaseSync(sidecar).close();
  return { root, primary, sidecar };
}

test("readiness counts only structurally eligible official program rows", () => {
  const fixture = setup();
  try {
    const result = readN2ObservationIngestReadiness({
      primaryDbPath: fixture.primary,
      sidecarDbPath: fixture.sidecar,
    });
    assert.equal(result.input.primaryOfficialProgram.totalRows, 6);
    assert.equal(result.input.primaryOfficialProgram.missingRawJson, 0);
    assert.equal(result.input.primaryOfficialProgram.missingSourceFile, 0);
    assert.equal(result.input.primaryOfficialProgram.missingImportedAt, 0);
    assert.equal(result.input.primaryOfficialProgram.missingCloseAt, 0);
    assert.equal(result.input.primaryOfficialProgram.eligibleRows, 1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
