import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { N2EdgeDiscoveryCandidate } from "./n2EdgeDiscoverySource";
import { readN2EdgeSelectedProgramFeatures } from "./n2EdgeSelectedProgramFeatures";

function candidate(): N2EdgeDiscoveryCandidate {
  return {
    canonicalRaceKey: "2004-01-01:11:R1",
    primaryRaceId: "20040101-びわこ-01",
    primaryIdentityEncoding: "venue_label",
    decisionCutoff: "2004-01-01T14:00:00.000Z",
    sourceObservedAt: "2004-01-01T01:00:00.000Z",
  };
}

test("stale selected metadata blocks before private raw_json is read", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-selected-metadata-preflight-"));
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
  db.prepare(`INSERT INTO official_programs
    (race_id,date,venue,race_no,close_at,source_file,raw_json,imported_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(
      "20040101-びわこ-01",
      "2004-01-01",
      "びわこ",
      1,
      "22:30",
      "/private/20040101-びわこ-01.json",
      "PRIVATE_RAW_MUST_NOT_BE_READ_FOR_STALE_METADATA",
      "2004-01-01 01:00:00",
    );
  db.close();

  try {
    const report = readN2EdgeSelectedProgramFeatures({
      primaryDbPath: path,
      selectedCandidates: [candidate()],
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("2004-01-01:11:R1:METADATA_CHANGED_AFTER_SELECTION"));
    assert.equal(report.matchedProgramCount, 1);
    assert.equal(report.rawJsonReadCount, 0);
    assert.equal(report.primaryDatabaseReadCount, 1);
    assert.deepEqual(report.programs, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
