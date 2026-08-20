import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildCanonicalTrifectaSelectionSpace } from "./n2TrifectaMarketFoundation";
import { readN2ObservationIngestReadiness } from "./n2ObservationIngestReadinessReader";

test("readiness does not count positive infinity odds as a complete market snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-finite-odds-"));
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
        checkpoint_label TEXT NOT NULL
      );
    `);
    const insert = primary.prepare(`
      INSERT INTO trifecta_market_raw_snapshots(
        race_id, bet_type, bet_selection, odds, captured_at, checkpoint_label
      ) VALUES ('20260805-01-01', 'trifecta', ?, ?, '2026-08-05T00:30:00.000Z', 'T-30')
    `);
    for (const selection of buildCanonicalTrifectaSelectionSpace()) {
      insert.run(selection, 10.5);
    }
    primary.exec("UPDATE trifecta_market_raw_snapshots SET odds=1e999 WHERE bet_selection='123'");
  } finally {
    primary.close();
    sidecar.close();
  }

  try {
    const readiness = readN2ObservationIngestReadiness({ primaryDbPath: primaryPath, sidecarDbPath: sidecarPath });
    assert.equal(readiness.input.primaryTrifectaMarket.validSelectionRows, 119);
    assert.equal(readiness.input.primaryTrifectaMarket.completeSnapshotCount, 0);
    assert.equal(readiness.input.primaryTrifectaMarket.rawLineageCompleteSnapshotCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
