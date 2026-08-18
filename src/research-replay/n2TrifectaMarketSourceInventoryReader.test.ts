import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildCanonicalTrifectaSelectionSpace } from "./n2TrifectaMarketFoundation";
import { readN2TrifectaMarketSourceInventory } from "./n2TrifectaMarketSourceInventoryReader";

function withTempDb(run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-trifecta-inventory-"));
  const path = join(dir, "boat.sqlite");
  try {
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createCompleteRawSource(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE official_programs (date TEXT NOT NULL);
      INSERT INTO official_programs(date) VALUES ('2026-08-06');
      CREATE TABLE trifecta_market_raw_snapshots (
        race_id TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        bet_selection TEXT NOT NULL,
        odds REAL NOT NULL,
        captured_at TEXT NOT NULL,
        available_at TEXT NOT NULL,
        decision_cutoff TEXT NOT NULL,
        checkpoint_label TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        raw_payload TEXT NOT NULL,
        raw_payload_digest TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        source_url TEXT
      );
    `);
    const insert = db.prepare(`
      INSERT INTO trifecta_market_raw_snapshots(
        race_id, bet_type, bet_selection, odds, captured_at, available_at, decision_cutoff,
        checkpoint_label, raw_document_id, raw_payload, raw_payload_digest, parse_run_id, source_url
      ) VALUES (?, 'trifecta', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec("BEGIN");
    for (const [index, selection] of buildCanonicalTrifectaSelectionSpace().entries()) {
      insert.run(
        "20260806-05-01",
        selection,
        index + 1.5,
        "2026-08-06T03:50:00.000Z",
        "2026-08-06T03:49:00.000Z",
        "2026-08-06T04:00:00.000Z",
        "T-10",
        "raw-1",
        "{}",
        "a".repeat(64),
        "parse-1",
        "https://example.invalid/market",
      );
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

test("reader inventories a complete raw market source without mutating the DB", () => {
  withTempDb((path) => {
    createCompleteRawSource(path);
    const before = statSync(path);
    const inventory = readN2TrifectaMarketSourceInventory({ primaryDbPath: path });
    const after = statSync(path);

    assert.equal(inventory.sourceTable, "trifecta_market_raw_snapshots");
    assert.equal(inventory.sourceTablePresent, true);
    assert.equal(inventory.totalRows, 120);
    assert.equal(inventory.raceCount, 1);
    assert.equal(inventory.checkpointCount, 1);
    assert.equal(inventory.completeSnapshotCount, 1);
    assert.equal(inventory.rawDocumentIdColumnPresent, true);
    assert.equal(inventory.rawPayloadColumnPresent, true);
    assert.equal(inventory.rawPayloadDigestColumnPresent, true);
    assert.equal(inventory.parseRunIdColumnPresent, true);
    assert.equal(inventory.capturedAtColumnPresent, true);
    assert.equal(inventory.availableAtColumnPresent, true);
    assert.equal(inventory.decisionCutoffColumnPresent, true);
    assert.equal(inventory.checkpointLabelColumnPresent, true);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});

test("reader rejects impossible official program cohort dates before source inventory queries", () => {
  withTempDb((path) => {
    const db = new DatabaseSync(path);
    try {
      db.exec(`
        CREATE TABLE official_programs (date TEXT NOT NULL);
        INSERT INTO official_programs(date) VALUES ('2026-02-30');
      `);
    } finally {
      db.close();
    }

    assert.throws(
      () => readN2TrifectaMarketSourceInventory({ primaryDbPath: path }),
      /OFFICIAL_PROGRAM_DATE_INVALID/,
    );
  });
});

test("reader exposes aggregate odds sources as lineage-incomplete instead of relabeling them", () => {
  withTempDb((path) => {
    const db = new DatabaseSync(path);
    try {
      db.exec(`
        CREATE TABLE official_programs (date TEXT NOT NULL);
        INSERT INTO official_programs(date) VALUES ('2026-08-06');
        CREATE TABLE odds_timeseries (
          race_id TEXT NOT NULL,
          bet_type TEXT NOT NULL,
          bet_selection TEXT NOT NULL,
          odds REAL NOT NULL,
          captured_at TEXT NOT NULL
        );
        INSERT INTO odds_timeseries VALUES ('20260806-05-01','trifecta','123',12.3,'2026-08-06T03:50:00.000Z');
      `);
    } finally {
      db.close();
    }

    const inventory = readN2TrifectaMarketSourceInventory({ primaryDbPath: path });
    assert.equal(inventory.sourceTable, "odds_timeseries");
    assert.equal(inventory.totalRows, 1);
    assert.equal(inventory.completeSnapshotCount, 0);
    assert.equal(inventory.rawDocumentIdColumnPresent, false);
    assert.equal(inventory.rawPayloadColumnPresent, false);
    assert.equal(inventory.rawPayloadDigestColumnPresent, false);
    assert.equal(inventory.parseRunIdColumnPresent, false);
    assert.equal(inventory.availableAtColumnPresent, false);
    assert.equal(inventory.decisionCutoffColumnPresent, false);
  });
});

test("reader blocks any active WAL instead of checkpointing or deleting it", () => {
  withTempDb((path) => {
    createCompleteRawSource(path);
    writeFileSync(`${path}-wal`, "active");
    assert.throws(
      () => readN2TrifectaMarketSourceInventory({ primaryDbPath: path }),
      /PRIMARY_DB_ACTIVE_WAL/,
    );
  });
});
