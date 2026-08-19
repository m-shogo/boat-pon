import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2TrifectaRealPlanPreflight } from "./n2TrifectaRealPlanPreflight.js";

function withTempDb(run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-real-plan-race-metadata-boundary-"));
  const path = join(dir, "boat.sqlite");
  try {
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("real plan preflight rejects invalid race metadata before the three-date bound", () => {
  withTempDb((path) => {
    const db = new DatabaseSync(path);
    try {
      db.exec(`
        CREATE TABLE official_programs (
          race_id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          venue TEXT NOT NULL,
          race_no INTEGER NOT NULL,
          close_at TEXT NOT NULL
        );
      `);
      const insert = db.prepare(`
        INSERT INTO official_programs(race_id, date, venue, race_no, close_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      insert.run("20260930-05-01", "2026-09-30", "05", 1, "12:00");
      insert.run("20261001-05-01", "2026-10-01", "05", 1, "24:00");
      insert.run("20261002-05-01", "2026-10-02", "05", 1, "12:00");
      insert.run("20261003-05-01", "2026-10-03", "05", 1, "12:00");
    } finally {
      db.close();
    }

    const report = readN2TrifectaRealPlanPreflight({
      primaryDbPath: path,
      now: "2026-09-29T15:00:00.000Z",
      executionLocation: "fixture",
    });

    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes(
      "OFFICIAL_PROGRAM_RACE_METADATA_INVALID:2026-10-01:05:20261001-05-01",
    ));
    assert.equal(report.inventory.discoveredDateCount, 0);
    assert.equal(report.inventory.discoveredVenueDayCount, 0);
    assert.equal(report.inventory.readableCandidatePlanCount, 0);
    assert.equal(report.networkExecuted, false);
    assert.equal(report.rawPersisted, false);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.productionApplyExecuted, false);
  });
});
