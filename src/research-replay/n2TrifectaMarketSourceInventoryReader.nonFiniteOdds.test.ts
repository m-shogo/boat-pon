import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildCanonicalTrifectaSelectionSpace } from "./n2TrifectaMarketFoundation";
import { readN2TrifectaMarketSourceInventory } from "./n2TrifectaMarketSourceInventoryReader";

test("source inventory does not count positive infinity odds as a complete snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-market-inventory-finite-odds-"));
  const primaryPath = join(root, "boat.sqlite");
  const db = new DatabaseSync(primaryPath);
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
        checkpoint_label TEXT NOT NULL
      );
    `);
    const insert = db.prepare(`
      INSERT INTO trifecta_market_raw_snapshots(
        race_id, bet_type, bet_selection, odds, captured_at, checkpoint_label
      ) VALUES ('20260806-05-01', 'trifecta', ?, ?, '2026-08-06T03:50:00.000Z', 'T-10')
    `);
    for (const selection of buildCanonicalTrifectaSelectionSpace()) {
      insert.run(selection, 10.5);
    }
    db.exec("UPDATE trifecta_market_raw_snapshots SET odds=1e999 WHERE bet_selection='123'");
  } finally {
    db.close();
  }

  try {
    const inventory = readN2TrifectaMarketSourceInventory({ primaryDbPath: primaryPath });
    assert.equal(inventory.totalRows, 120);
    assert.equal(inventory.completeSnapshotCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
