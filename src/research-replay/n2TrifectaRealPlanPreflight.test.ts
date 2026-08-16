import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildN2TrifectaOddsCheckpointPlan } from "./n2TrifectaOddsCheckpointCollection.js";
import {
  readN2TrifectaRealPlanPreflight,
  selectN2TrifectaFuturePlan,
} from "./n2TrifectaRealPlanPreflight.js";

function candidate(date: string, venueCode: string, raceCount: number, closeAt: string) {
  return {
    date,
    venueCode,
    sourcePlan: buildN2TrifectaOddsCheckpointPlan({
      stage: "ONE_VENUE_REVIEW" as const,
      races: Array.from({ length: raceCount }, (_, index) => ({
        date,
        venueCode,
        raceNo: index + 1,
        closeAt,
      })),
    }),
  };
}

function withTempDb(run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-real-plan-preflight-"));
  const path = join(dir, "boat.sqlite");
  try {
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createPrograms(path: string): void {
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
    for (let raceNo = 1; raceNo <= 3; raceNo += 1) {
      insert.run(
        `20260806-多摩川-${String(raceNo).padStart(2, "0")}`,
        "2026-08-06",
        "多摩川",
        raceNo,
        raceNo === 1 ? "09:00" : "10:05",
      );
    }
    for (let raceNo = 1; raceNo <= 2; raceNo += 1) {
      insert.run(
        `20260806-住之江-${String(raceNo).padStart(2, "0")}`,
        "2026-08-06",
        "住之江",
        raceNo,
        "10:35",
      );
    }
    insert.run(
      "20260807-05-01",
      "2026-08-07",
      "05",
      1,
      "10:05",
    );
  } finally {
    db.close();
  }
}

test("future selector keeps only races whose complete T-30 path is still available", () => {
  const result = selectN2TrifectaFuturePlan({
    now: "2026-08-06T00:00:00.000Z",
    candidates: [
      candidate("2026-08-06", "05", 3, "09:00"),
      candidate("2026-08-06", "12", 2, "10:35"),
    ],
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.selectedVenueCode, "12");
  assert.equal(result.selectedDate, "2026-08-06");
  assert.equal(result.selectedRaceCount, 2);
  assert.equal(result.plan?.requestBudget, 8);
  assert.equal(result.approvalCreated, false);
  assert.equal(result.networkExecuted, false);
  assert.equal(result.databaseWriteCount, 0);
});

test("future selector rejects normalized now timestamps", () => {
  const result = selectN2TrifectaFuturePlan({
    now: "2026-08-05T24:00:00Z",
    candidates: [candidate("2026-08-06", "12", 2, "10:35")],
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("INVALID_NOW"));
  assert.equal(result.networkExecuted, false);
  assert.equal(result.databaseWriteCount, 0);
});

test("candidate with more fully future races wins before later date", () => {
  const result = selectN2TrifectaFuturePlan({
    now: "2026-08-06T00:00:00.000Z",
    candidates: [
      candidate("2026-08-07", "05", 1, "10:05"),
      candidate("2026-08-06", "12", 2, "10:35"),
    ],
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.selectedDate, "2026-08-06");
  assert.equal(result.selectedVenueCode, "12");
  assert.equal(result.selectedRaceCount, 2);
});

test("no future T-30 checkpoint is explicit and never relabels a later checkpoint", () => {
  const result = selectN2TrifectaFuturePlan({
    now: "2026-08-06T01:00:00.000Z",
    candidates: [candidate("2026-08-06", "05", 1, "10:05")],
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.blockers, ["NO_RACES_WITH_ALL_CHECKPOINTS_FUTURE"]);
  assert.equal(result.plan, null);
  assert.equal(result.selectedRaceCount, 0);
});

test("real DB preflight chooses the largest future one-venue cohort read-only", () => {
  withTempDb((path) => {
    createPrograms(path);
    const before = statSync(path);
    const report = readN2TrifectaRealPlanPreflight({
      primaryDbPath: path,
      now: "2026-08-06T00:00:00.000Z",
      executionLocation: "fixture",
    });
    const after = statSync(path);

    assert.equal(report.status, "PASS");
    assert.deepEqual(report.blockers, []);
    assert.equal(report.inventory.requestedDateFrom, "2026-08-06");
    assert.equal(report.inventory.discoveredDateCount, 2);
    assert.equal(report.inventory.discoveredVenueDayCount, 3);
    assert.equal(report.inventory.readableCandidatePlanCount, 3);
    assert.equal(report.selection.selectedDate, "2026-08-06");
    assert.equal(report.selection.selectedVenueCode, "05");
    assert.equal(report.selection.selectedRaceCount, 2);
    assert.equal(report.selection.plan?.requestBudget, 8);
    assert.equal(report.source.metadataUnchanged, true);
    assert.equal(report.networkExecuted, false);
    assert.equal(report.rawPersisted, false);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.approvalCreated, false);
    assert.equal(report.productionApplyExecuted, false);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});

test("normalized now is blocked before private DB discovery", () => {
  withTempDb((path) => {
    createPrograms(path);
    const before = statSync(path);
    const report = readN2TrifectaRealPlanPreflight({
      primaryDbPath: path,
      now: "2026-08-05T24:00:00Z",
      executionLocation: "fixture",
    });
    const after = statSync(path);

    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("INVALID_NOW"));
    assert.equal(report.inventory.requestedDateFrom, "INVALID");
    assert.equal(report.inventory.discoveredDateCount, 0);
    assert.equal(report.inventory.discoveredVenueDayCount, 0);
    assert.equal(report.inventory.readableCandidatePlanCount, 0);
    assert.equal(report.source.metadataUnchanged, true);
    assert.equal(report.networkExecuted, false);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});

test("active WAL produces blocked evidence without touching the WAL", () => {
  withTempDb((path) => {
    createPrograms(path);
    const walPath = `${path}-wal`;
    writeFileSync(walPath, "active");
    const before = statSync(walPath);
    const report = readN2TrifectaRealPlanPreflight({
      primaryDbPath: path,
      now: "2026-08-06T00:00:00.000Z",
      executionLocation: "fixture",
    });
    const after = statSync(walPath);

    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("PRIMARY_DB_ACTIVE_WAL"));
    assert.equal(report.source.walBytesBefore, 6);
    assert.equal(report.source.walBytesAfter, 6);
    assert.equal(report.source.metadataUnchanged, true);
    assert.equal(report.networkExecuted, false);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});
