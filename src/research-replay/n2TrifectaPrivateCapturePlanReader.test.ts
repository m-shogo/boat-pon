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

import { readN2TrifectaPrivateCapturePlan } from "./n2TrifectaPrivateCapturePlanReader.js";

function withTempDb(run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-private-capture-plan-"));
  const path = join(dir, "boat.sqlite");
  try {
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createPrograms(
  path: string,
  input: {
    venue: string;
    raceIdVenue?: string;
    count?: number;
    duplicateRaceNo?: boolean;
    invalidCloseAt?: boolean;
    identityMismatch?: boolean;
  },
): void {
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
    const count = input.count ?? 12;
    for (let index = 0; index < count; index += 1) {
      const raceNo = index + 1;
      const suffix = String(raceNo).padStart(2, "0");
      const identityVenue = input.raceIdVenue ?? input.venue;
      const raceId = input.identityMismatch && raceNo === 1
        ? `20260806-wrong-${suffix}`
        : `20260806-${identityVenue}-${suffix}`;
      const closeAt = input.invalidCloseAt && raceNo === 1
        ? "bad"
        : `${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "05" : "35"}:00`;
      insert.run(raceId, "2026-08-06", input.venue, raceNo, closeAt);
    }
    if (input.duplicateRaceNo) {
      insert.run(
        `20260806-${input.raceIdVenue ?? input.venue}-duplicate`,
        "2026-08-06",
        input.venue,
        1,
        "10:10:00",
      );
    }
  } finally {
    db.close();
  }
}

test("venue-label official programs produce a 48-request immutable one-venue plan", () => {
  withTempDb((path) => {
    createPrograms(path, { venue: "多摩川" });
    const before = statSync(path);
    const result = readN2TrifectaPrivateCapturePlan({
      primaryDbPath: path,
      date: "2026-08-06",
      venueCode: "05",
    });
    const after = statSync(path);

    assert.equal(result.status, "PASS");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.source.readOnly, true);
    assert.equal(result.source.queryOnly, true);
    assert.equal(result.source.immutable, true);
    assert.equal(result.source.walBytes, 0);
    assert.equal(result.source.metadataUnchanged, true);
    assert.equal(result.sourceRowCount, 12);
    assert.equal(result.selectedRaceCount, 12);
    assert.equal(result.selectedRaceIds.length, 12);
    assert.equal(result.plan.status, "READY_FOR_PRIVATE_REVIEW");
    assert.equal(result.plan.raceCount, 12);
    assert.equal(result.plan.requestBudget, 48);
    assert.equal(result.plan.entries.length, 48);
    assert.equal(result.databaseWriteCount, 0);
    assert.equal(result.approvalCreated, false);
    assert.equal(result.networkExecuted, false);
    assert.equal(result.productionApplyExecuted, false);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});

test("legacy venue-code official program identities remain supported", () => {
  withTempDb((path) => {
    createPrograms(path, { venue: "05", count: 2 });
    const result = readN2TrifectaPrivateCapturePlan({
      primaryDbPath: path,
      date: "2026-08-06",
      venueCode: "05",
    });

    assert.equal(result.status, "PASS");
    assert.equal(result.selectedRaceCount, 2);
    assert.equal(result.plan.requestBudget, 8);
    assert.deepEqual(result.selectedRaceIds, ["20260806-05-01", "20260806-05-02"]);
  });
});

test("label row may use the canonical code-form race ID", () => {
  withTempDb((path) => {
    createPrograms(path, {
      venue: "多摩川",
      raceIdVenue: "05",
      count: 1,
    });
    const result = readN2TrifectaPrivateCapturePlan({
      primaryDbPath: path,
      date: "2026-08-06",
      venueCode: "05",
    });

    assert.equal(result.status, "PASS");
    assert.equal(result.selectedRaceCount, 1);
    assert.equal(result.plan.requestBudget, 4);
  });
});

test("active primary WAL blocks before immutable access and is never altered", () => {
  withTempDb((path) => {
    createPrograms(path, { venue: "多摩川", count: 1 });
    const walPath = `${path}-wal`;
    writeFileSync(walPath, "active-wal");
    const before = statSync(walPath);

    assert.throws(
      () => readN2TrifectaPrivateCapturePlan({
        primaryDbPath: path,
        date: "2026-08-06",
        venueCode: "05",
      }),
      /PRIMARY_DB_ACTIVE_WAL/,
    );
    const after = statSync(walPath);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});

test("duplicate race number blocks the complete plan rather than choosing one row", () => {
  withTempDb((path) => {
    createPrograms(path, {
      venue: "多摩川",
      count: 1,
      duplicateRaceNo: true,
    });
    const result = readN2TrifectaPrivateCapturePlan({
      primaryDbPath: path,
      date: "2026-08-06",
      venueCode: "05",
    });

    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.includes("DUPLICATE_RACE_NO"));
    assert.equal(result.plan.status, "BLOCKED");
    assert.equal(result.plan.entries.length, 0);
    assert.equal(result.networkExecuted, false);
  });
});

test("invalid close time and race identity mismatch both fail closed", () => {
  withTempDb((invalidTimePath) => {
    createPrograms(invalidTimePath, {
      venue: "多摩川",
      count: 1,
      invalidCloseAt: true,
    });
    const result = readN2TrifectaPrivateCapturePlan({
      primaryDbPath: invalidTimePath,
      date: "2026-08-06",
      venueCode: "05",
    });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.includes("INVALID_CLOSE_AT"));
    assert.equal(result.plan.entries.length, 0);
  });

  withTempDb((identityPath) => {
    createPrograms(identityPath, {
      venue: "多摩川",
      count: 1,
      identityMismatch: true,
    });
    const result = readN2TrifectaPrivateCapturePlan({
      primaryDbPath: identityPath,
      date: "2026-08-06",
      venueCode: "05",
    });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.includes("RACE_IDENTITY_MISMATCH"));
    assert.equal(result.plan.entries.length, 0);
  });
});

test("empty venue selection is explicit and never falls back to another venue", () => {
  withTempDb((path) => {
    createPrograms(path, { venue: "住之江", count: 1 });
    const result = readN2TrifectaPrivateCapturePlan({
      primaryDbPath: path,
      date: "2026-08-06",
      venueCode: "05",
    });

    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.includes("VENUE_PROGRAMS_EMPTY"));
    assert.equal(result.selectedRaceCount, 0);
    assert.equal(result.plan.entries.length, 0);
  });
});
