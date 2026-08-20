import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildCanonicalTrifectaSelectionSpace } from "./n2TrifectaMarketFoundation";
import { readN2TrifectaMarketSourceInventory } from "./n2TrifectaMarketSourceInventoryReader";

function withTempDb(run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-trifecta-inventory-race-day-"));
  const path = join(dir, "boat.sqlite");
  try {
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createSnapshot(path: string, capturedAt: string): void {
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
        captured_at TEXT NOT NULL
      );
    `);
    const insert = db.prepare(`
      INSERT INTO trifecta_market_raw_snapshots(
        race_id, bet_type, bet_selection, odds, captured_at
      ) VALUES ('20260806-05-01', 'trifecta', ?, ?, ?)
    `);
    db.exec("BEGIN");
    for (const [index, selection] of buildCanonicalTrifectaSelectionSpace().entries()) {
      insert.run(selection, index + 1.5, capturedAt);
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

test("reader requires complete market snapshots to be captured on the race day in JST", () => {
  withTempDb((path) => {
    createSnapshot(path, "2026-08-05T14:59:00.000Z");

    const inventory = readN2TrifectaMarketSourceInventory({ primaryDbPath: path });

    assert.equal(inventory.totalRows, 120);
    assert.equal(inventory.completeSnapshotCount, 0);
  });
});

test("reader accepts explicit offsets when the capture instant belongs to the race day in JST", () => {
  withTempDb((path) => {
    createSnapshot(path, "2026-08-06T12:50:00.000+09:00");

    const inventory = readN2TrifectaMarketSourceInventory({ primaryDbPath: path });

    assert.equal(inventory.completeSnapshotCount, 1);
  });
});
