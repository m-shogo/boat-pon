import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2TrifectaPrivateCapturePlan } from "./n2TrifectaPrivateCapturePlanReader.js";

test("private capture plan rejects a whitespace-normalized venue alias", () => {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-private-plan-canonical-venue-"));
  const path = join(dir, "boat.sqlite");
  try {
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
      db.prepare(`
        INSERT INTO official_programs(race_id, date, venue, race_no, close_at)
        VALUES (?, ?, ?, ?, ?)
      `).run("20260806- 多摩川 -01", "2026-08-06", " 多摩川 ", 1, "10:05:00");
    } finally {
      db.close();
    }

    const result = readN2TrifectaPrivateCapturePlan({
      primaryDbPath: path,
      date: "2026-08-06",
      venueCode: "05",
    });

    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.includes("INVALID_VENUE"));
    assert.equal(result.selectedRaceCount, 0);
    assert.equal(result.plan.entries.length, 0);
    assert.equal(result.databaseWriteCount, 0);
    assert.equal(result.networkExecuted, false);
    assert.equal(result.productionApplyExecuted, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
