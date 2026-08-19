import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2ObservationIngestReadiness } from "./n2ObservationIngestReadinessReader";

function trifectaSelections(): string[] {
  const selections: string[] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        selections.push(`${first}${second}${third}`);
      }
    }
  }
  return selections;
}

function createPrimary(path: string, capturedAt: string): void {
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
      CREATE TABLE odds_timeseries_snapshots (
        race_id TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        bet_selection TEXT NOT NULL,
        odds REAL NOT NULL,
        captured_at TEXT NOT NULL,
        checkpoint_label TEXT
      );
    `);
    db.prepare("INSERT INTO official_programs VALUES(?,?,?,?,?,?,?,?)").run(
      "20260805-01-01",
      "2026-08-05",
      "01",
      1,
      "12:00",
      "program.json",
      JSON.stringify({ race: 1 }),
      "2026-08-05T00:00:00.000Z",
    );
    const insertOdds = db.prepare("INSERT INTO odds_timeseries_snapshots VALUES(?,?,?,?,?,?)");
    for (const selection of trifectaSelections()) {
      insertOdds.run("20260805-01-01", "trifecta", selection, 10, capturedAt, "T-30");
    }
  } finally {
    db.close();
  }
}

function readWithCapturedAt(capturedAt: string) {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-capture-time-"));
  const primary = join(root, "boat.sqlite");
  const sidecar = join(root, "research-replay.sqlite");
  createPrimary(primary, capturedAt);
  new DatabaseSync(sidecar).close();
  try {
    return readN2ObservationIngestReadiness({ primaryDbPath: primary, sidecarDbPath: sidecar });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("complete trifecta snapshots require an explicit valid capture timestamp", () => {
  for (const capturedAt of [
    "2026-08-05T24:00:00Z",
    "2026-02-30T10:00:00Z",
    "2026-08-05T10:00:00",
  ]) {
    const result = readWithCapturedAt(capturedAt);
    assert.equal(result.input.primaryTrifectaMarket.totalRows, 120, capturedAt);
    assert.equal(result.input.primaryTrifectaMarket.completeSnapshotCount, 0, capturedAt);
  }
});

test("complete trifecta snapshots retain valid explicit timezone offsets", () => {
  const result = readWithCapturedAt("2026-08-05T11:30:00+09:00");
  assert.equal(result.input.primaryTrifectaMarket.completeSnapshotCount, 1);
});
