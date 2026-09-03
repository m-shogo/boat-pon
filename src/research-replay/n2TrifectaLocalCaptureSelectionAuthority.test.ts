import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
  N2_TRIFECTA_LOCAL_CAPTURE_SELECTION_VERSION,
  runN2TrifectaLocalCaptureTick,
  type N2TrifectaLocalCaptureAuthorization,
} from "./n2TrifectaLocalCaptureService.js";

function authorization(): N2TrifectaLocalCaptureAuthorization {
  return {
    authorizationVersion: N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
    authorizationId: "AUTH-N2-TRI-LOCAL-private-research-0001",
    issuedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    stage: "ONE_VENUE_REVIEW",
    maxRequestsPerDay: 48,
    checkpointLabels: ["T-30", "T-20", "T-10", "T-5"],
    minInterRequestMs: 10_000,
    privateResearchOnly: true,
    publicRedistributionAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    automatedBettingAuthorized: false,
  };
}

function createPrograms(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
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
    for (const venue of ["05", "06"]) {
      insert.run(`20260806-${venue}-01`, "2026-08-06", venue, 1, "10:05:00");
    }
  } finally {
    db.close();
  }
}

test("hardlinked daily selection cannot steer venue authority", async () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-local-selection-authority-"));
  try {
    const dbPath = join(root, "data", "boat.sqlite");
    createPrograms(dbPath);

    const selectionDir = join(root, "data", "private", "trifecta-capture", "selections");
    mkdirSync(selectionDir, { recursive: true, mode: 0o700 });
    const aliasTarget = join(root, "forged-selection.json");
    writeFileSync(aliasTarget, `${JSON.stringify({
      selectionVersion: N2_TRIFECTA_LOCAL_CAPTURE_SELECTION_VERSION,
      date: "2026-08-06",
      venueCode: "06",
      sourcePlanDigest: "forged-but-previously-unchecked",
      selectedAt: "2026-08-06T00:20:00.000Z",
      raceCount: 1,
      requestBudget: 4,
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    linkSync(aliasTarget, join(selectionDir, "2026-08-06.json"));

    const report = await runN2TrifectaLocalCaptureTick({
      dataRoot: root,
      primaryDbPath: dbPath,
      authorization: authorization(),
      now: "2026-08-06T00:20:00.000Z",
    });

    assert.equal(report.status, "BLOCKED");
    assert.equal(report.selectedVenueCode, null);
    assert.ok(report.blockers.includes("SERVICE_PRIVATE_JSON_FILE_AUTHORITY_INVALID"));
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.currentBuyChanged, false);
    assert.equal(report.lineChanged, false);
    assert.equal(report.publicPublished, false);
    assert.equal(report.automatedBettingChanged, false);
    assert.equal(report.productionApplyExecuted, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
