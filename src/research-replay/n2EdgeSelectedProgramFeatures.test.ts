import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { N2EdgeDiscoveryCandidate } from "./n2EdgeDiscoverySource";
import { readN2EdgeSelectedProgramFeatures } from "./n2EdgeSelectedProgramFeatures";

function withPrimary(fn: (path: string, db: DatabaseSync) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-selected-program-"));
  const path = join(root, "primary.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      venue TEXT NOT NULL,
      race_no INTEGER NOT NULL,
      close_at TEXT NOT NULL,
      source_file TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
  `);
  try { fn(path, db); } finally {
    try { db.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true });
  }
}

function rawProgram(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      registrationNo: String(4000 + index),
      racerName: `Racer ${index + 1}`,
      className: index === 0 ? "A1" : "B1",
      nationalWinRate: 4.5 + index / 10,
      nationalTop2Rate: 30 + index,
      localWinRate: 4.2 + index / 10,
      localTop2Rate: 28 + index,
      motorNo: String(10 + index),
      motorTop2Rate: 32 + index,
      boatNo: String(20 + index),
      boatTop2Rate: 31 + index,
    })),
    ...overrides,
  });
}

function insertProgram(db: DatabaseSync, input: {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  rawJson?: string;
  closeAt?: string;
  importedAt?: string;
}): void {
  db.prepare(`INSERT INTO official_programs
    (race_id,date,venue,race_no,close_at,source_file,raw_json,imported_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(
      input.raceId,
      input.date,
      input.venue,
      input.raceNo,
      input.closeAt ?? "23:00",
      `/private/${input.raceId}.json`,
      input.rawJson ?? rawProgram(),
      input.importedAt ?? `${input.date} 01:00:00`,
    );
}

function candidate(input: {
  raceId: string;
  date: string;
  venueCode: string;
  raceNo: number;
  encoding?: "venue_label" | "venue_code";
  decisionCutoff?: string;
  sourceObservedAt?: string;
}): N2EdgeDiscoveryCandidate {
  return {
    canonicalRaceKey: `${input.date}:${input.venueCode}:R${input.raceNo}`,
    primaryRaceId: input.raceId,
    primaryIdentityEncoding: input.encoding ?? "venue_label",
    decisionCutoff: input.decisionCutoff ?? `${input.date}T14:00:00.000Z`,
    sourceObservedAt: input.sourceObservedAt ?? `${input.date}T01:00:00.000Z`,
  };
}

test("reader reads raw JSON only for selected candidates and emits identity-free safe snapshots", () => {
  withPrimary((path, db) => {
    insertProgram(db, { raceId: "20040101-びわこ-01", date: "2004-01-01", venue: "びわこ", raceNo: 1 });
    insertProgram(db, { raceId: "20040101-びわこ-02", date: "2004-01-01", venue: "びわこ", raceNo: 2, rawJson: "THIS_UNSELECTED_ROW_MUST_NOT_BE_PARSED" });
    db.close();

    const report = readN2EdgeSelectedProgramFeatures({
      primaryDbPath: path,
      selectedCandidates: [candidate({
        raceId: "20040101-びわこ-01",
        date: "2004-01-01",
        venueCode: "11",
        raceNo: 1,
      })],
    });
    assert.equal(report.status, "PASS");
    assert.equal(report.requestedRaceCount, 1);
    assert.equal(report.matchedProgramCount, 1);
    assert.equal(report.rawJsonReadCount, 1);
    assert.equal(report.parsedProgramCount, 1);
    assert.equal(report.safeProgramCount, 1);
    assert.equal(report.identityFieldCountPublished, 0);
    assert.equal(report.liveOnlyFeatureValueCount, 0);
    assert.equal(report.venueSpecificUnprovenFeatureValueCount, 0);
    assert.equal(report.programs[0].programFeatures.boats.length, 6);
    const serialized = JSON.stringify(report.programs[0].programFeatures);
    assert.doesNotMatch(serialized, /registrationNo|racerName|motorNo|boatNo/u);
    assert.doesNotMatch(serialized, /Racer/u);
    for (const boat of report.programs[0].programFeatures.boats) {
      assert.equal(boat.courseAvgSt, null);
      assert.equal(boat.courseTop3Rate, null);
      assert.equal(boat.flyingCount, null);
      assert.equal(boat.lateStartCount, null);
      assert.equal(boat.exhibitionStResidual, null);
      assert.equal(boat.venueMotorTop2Rate, null);
      assert.equal(boat.venueBoatTop2Rate, null);
    }
    assert.equal(report.primaryDatabaseWriteCount, 0);
    assert.equal(report.networkRequestCount, 0);
  });
});

test("metadata changed after candidate selection fails closed", () => {
  withPrimary((path, db) => {
    insertProgram(db, {
      raceId: "20040101-びわこ-01",
      date: "2004-01-01",
      venue: "びわこ",
      raceNo: 1,
      closeAt: "22:30",
    });
    db.close();
    const report = readN2EdgeSelectedProgramFeatures({
      primaryDbPath: path,
      selectedCandidates: [candidate({
        raceId: "20040101-びわこ-01",
        date: "2004-01-01",
        venueCode: "11",
        raceNo: 1,
      })],
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("2004-01-01:11:R1:METADATA_CHANGED_AFTER_SELECTION"));
    assert.deepEqual(report.programs, []);
  });
});

test("post-cutoff metadata regression is rejected again during raw read", () => {
  withPrimary((path, db) => {
    insertProgram(db, {
      raceId: "20040101-びわこ-01",
      date: "2004-01-01",
      venue: "びわこ",
      raceNo: 1,
      importedAt: "2004-01-01 15:00:00",
    });
    db.close();
    const report = readN2EdgeSelectedProgramFeatures({
      primaryDbPath: path,
      selectedCandidates: [candidate({
        raceId: "20040101-びわこ-01",
        date: "2004-01-01",
        venueCode: "11",
        raceNo: 1,
      })],
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("2004-01-01:11:R1:METADATA_REVALIDATION_POST_CUTOFF_PRIMARY_IMPORT"));
  });
});

test("malformed selected raw JSON fails closed", () => {
  withPrimary((path, db) => {
    insertProgram(db, {
      raceId: "20040101-びわこ-01",
      date: "2004-01-01",
      venue: "びわこ",
      raceNo: 1,
      rawJson: "{bad-json",
    });
    db.close();
    const report = readN2EdgeSelectedProgramFeatures({
      primaryDbPath: path,
      selectedCandidates: [candidate({ raceId: "20040101-びわこ-01", date: "2004-01-01", venueCode: "11", raceNo: 1 })],
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("2004-01-01:11:R1:RAW_JSON_PARSE_FAILED"));
  });
});

test("incomplete or duplicate course set fails closed", () => {
  withPrimary((path, db) => {
    const raw = JSON.parse(rawProgram()) as { boats: Array<Record<string, unknown>> };
    raw.boats.pop();
    insertProgram(db, {
      raceId: "20040101-びわこ-01",
      date: "2004-01-01",
      venue: "びわこ",
      raceNo: 1,
      rawJson: JSON.stringify(raw),
    });
    db.close();
    const report = readN2EdgeSelectedProgramFeatures({
      primaryDbPath: path,
      selectedCandidates: [candidate({ raceId: "20040101-びわこ-01", date: "2004-01-01", venueCode: "11", raceNo: 1 })],
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("2004-01-01:11:R1:BOAT_COUNT_5/6"));
    assert.ok(report.blockers.some((blocker) => blocker.startsWith("2004-01-01:11:R1:COURSE_SET_")));
  });
});

test("missing selected primary row fails closed instead of shrinking the cohort", () => {
  withPrimary((path, db) => {
    db.close();
    const report = readN2EdgeSelectedProgramFeatures({
      primaryDbPath: path,
      selectedCandidates: [candidate({ raceId: "20040101-びわこ-01", date: "2004-01-01", venueCode: "11", raceNo: 1 })],
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("MATCHED_PROGRAM_COUNT:0/1"));
    assert.ok(report.blockers.includes("2004-01-01:11:R1:SELECTED_PROGRAM_MISSING"));
    assert.equal(report.rawJsonReadCount, 0);
  });
});

test("duplicate candidate identity and pre-cutoff regression are rejected before database read", () => {
  const one = candidate({ raceId: "20040101-びわこ-01", date: "2004-01-01", venueCode: "11", raceNo: 1 });
  const duplicate = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: "/does/not/exist.sqlite",
    selectedCandidates: [one, one],
  });
  assert.equal(duplicate.status, "BLOCKED");
  assert.ok(duplicate.blockers.includes("DUPLICATE_CANONICAL_RACE_KEY"));
  assert.ok(duplicate.blockers.includes("DUPLICATE_PRIMARY_RACE_ID"));
  assert.equal(duplicate.primaryDatabaseReadCount, 0);

  const badTiming = readN2EdgeSelectedProgramFeatures({
    primaryDbPath: "/does/not/exist.sqlite",
    selectedCandidates: [{ ...one, sourceObservedAt: one.decisionCutoff }],
  });
  assert.equal(badTiming.status, "BLOCKED");
  assert.ok(badTiming.blockers.includes("2004-01-01:11:R1:SOURCE_NOT_PRE_CUTOFF"));
  assert.equal(badTiming.primaryDatabaseReadCount, 0);
});

test("selected reader output is deterministic", () => {
  withPrimary((path, db) => {
    insertProgram(db, { raceId: "20040101-びわこ-01", date: "2004-01-01", venue: "びわこ", raceNo: 1 });
    db.close();
    const selected = [candidate({ raceId: "20040101-びわこ-01", date: "2004-01-01", venueCode: "11", raceNo: 1 })];
    const first = readN2EdgeSelectedProgramFeatures({ primaryDbPath: path, selectedCandidates: selected });
    const second = readN2EdgeSelectedProgramFeatures({ primaryDbPath: path, selectedCandidates: selected });
    assert.equal(first.status, "PASS");
    assert.equal(first.outputDigest, second.outputDigest);
    assert.deepEqual(first.programs, second.programs);
  });
});
