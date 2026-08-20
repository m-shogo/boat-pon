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

test("readiness prefers the reviewed raw market source over aggregate odds tables", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-source-priority-"));
  const primaryPath = join(root, "boat.sqlite");
  const sidecarPath = join(root, "research-replay.sqlite");
  const primary = new DatabaseSync(primaryPath);
  const sidecar = new DatabaseSync(sidecarPath);
  try {
    primary.exec(`
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
      INSERT INTO official_programs VALUES(
        '20260805-01-01','2026-08-05','01',1,'12:00','program.json','{}','2026-08-05T00:00:00.000Z'
      );
      CREATE TABLE trifecta_market_raw_snapshots (
        race_id TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        bet_selection TEXT NOT NULL,
        odds REAL NOT NULL,
        captured_at TEXT NOT NULL,
        checkpoint_label TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        raw_payload TEXT NOT NULL,
        raw_payload_digest TEXT NOT NULL,
        parse_run_id TEXT NOT NULL
      );
      CREATE TABLE odds_timeseries_snapshots (
        race_id TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        bet_selection TEXT NOT NULL,
        odds REAL NOT NULL,
        captured_at TEXT NOT NULL,
        checkpoint_label TEXT NOT NULL
      );
    `);
    const insertAggregate = primary.prepare("INSERT INTO odds_timeseries_snapshots VALUES(?,?,?,?,?,?)");
    for (const selection of trifectaSelections()) {
      insertAggregate.run(
        "20260805-01-01",
        "trifecta",
        selection,
        10.5,
        "2026-08-05T00:30:00.000Z",
        "T-30",
      );
    }
  } finally {
    primary.close();
    sidecar.close();
  }

  try {
    const result = readN2ObservationIngestReadiness({ primaryDbPath: primaryPath, sidecarDbPath: sidecarPath });
    assert.equal(result.sourceIdentity.oddsSourceTable, "trifecta_market_raw_snapshots");
    assert.equal(result.input.primaryTrifectaMarket.totalRows, 0);
    assert.equal(result.input.primaryTrifectaMarket.completeSnapshotCount, 0);
    assert.equal(result.input.primaryTrifectaMarket.rawDocumentIdColumnPresent, true);
    assert.equal(result.input.primaryTrifectaMarket.rawPayloadColumnPresent, true);
    assert.equal(result.input.primaryTrifectaMarket.rawPayloadDigestColumnPresent, true);
    assert.equal(result.input.primaryTrifectaMarket.parseRunIdColumnPresent, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
