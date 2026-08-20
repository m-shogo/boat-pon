import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readN2ObservationIngestReadiness } from "./n2ObservationIngestReadinessReader";

function validRawJson(): string {
  return JSON.stringify({
    boats: [
      {
        course: 1,
        registrationNo: "4001",
        className: "A1",
        nationalWinRate: 7.1,
        nationalTop2Rate: 55.2,
        localWinRate: 6.8,
        localTop2Rate: 50.1,
        motorTop2Rate: 40.2,
        boatTop2Rate: 38.4,
      },
      {
        course: 2,
        registrationNo: "4002",
        className: "A2",
        nationalWinRate: 6.2,
        nationalTop2Rate: 44.1,
        localWinRate: null,
        localTop2Rate: null,
        motorTop2Rate: 35.1,
        boatTop2Rate: 36,
      },
    ],
  });
}

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
    insert.run("20260805-01-01", "2026-08-05", "01", 1, "12:00", "valid.json", validRawJson(), "2026-08-05T00:00:00.000Z");
    insert.run("20260805-01-02", "2026-08-05", "01", 2, "12:00", "payload.json", "{}", "2026-08-05T00:00:00.000Z");
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

test("readiness counts only producer-valid official program rows", () => {
  const fixture = setup();
  try {
    const result = readN2ObservationIngestReadiness({
      primaryDbPath: fixture.primary,
      sidecarDbPath: fixture.sidecar,
    });
    assert.equal(result.input.primaryOfficialProgram.totalRows, 7);
    assert.equal(result.input.primaryOfficialProgram.missingRawJson, 0);
    assert.equal(result.input.primaryOfficialProgram.missingSourceFile, 0);
    assert.equal(result.input.primaryOfficialProgram.missingImportedAt, 0);
    assert.equal(result.input.primaryOfficialProgram.missingCloseAt, 0);
    assert.equal(result.input.primaryOfficialProgram.eligibleRows, 1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
