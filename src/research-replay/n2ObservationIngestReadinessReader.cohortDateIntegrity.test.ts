import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2ObservationIngestReadiness } from "./n2ObservationIngestReadinessReader";

function createPrimary(path: string): void {
  const db = new DatabaseSync(path);
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
    insert.run(
      "20260832-01-01",
      "2026-08-32",
      "01",
      1,
      "12:00",
      "program-invalid.json",
      JSON.stringify({ race: 1 }),
      "2026-08-31T00:00:00.000Z",
    );
    insert.run(
      "20260902-01-01",
      "2026-09-02",
      "01",
      1,
      "12:00",
      "program-valid.json",
      JSON.stringify({ race: 1 }),
      "2026-09-02T00:00:00.000Z",
    );
  } finally {
    db.close();
  }
}

function createSidecar(path: string): void {
  new DatabaseSync(path).close();
}

test("reader rejects impossible program dates inside the seven-day cohort before counting readiness", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-cohort-date-integrity-"));
  const primary = join(root, "boat.sqlite");
  const sidecar = join(root, "research-replay.sqlite");
  createPrimary(primary);
  createSidecar(sidecar);
  try {
    assert.throws(
      () => readN2ObservationIngestReadiness({ primaryDbPath: primary, sidecarDbPath: sidecar }),
      /N2_READINESS_INVALID_MAX_DATE/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
