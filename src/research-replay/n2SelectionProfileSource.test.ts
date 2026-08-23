import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2SelectionProfileSource } from "./n2SelectionProfileSource";

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE raw_documents (
      raw_document_id TEXT PRIMARY KEY,
      integrity_status TEXT NOT NULL,
      security_scan_status TEXT NOT NULL,
      parser_replay_eligible INTEGER NOT NULL
    );
    CREATE TABLE parse_runs (
      parse_run_id TEXT PRIMARY KEY,
      raw_document_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE domain_observations (
      observation_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      observation_type TEXT NOT NULL,
      payload_type TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL
    );
    CREATE TABLE settlement_candidates_v2 (
      candidate_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      bet_type TEXT NOT NULL,
      settlement_status TEXT NOT NULL,
      resolution_status TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      supersedes_candidate_id TEXT
    );
    CREATE TABLE race_payout_lines_v2 (
      payout_line_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      selection_canonical TEXT,
      payout_yen INTEGER NOT NULL,
      line_kind TEXT NOT NULL
    );
    CREATE TABLE race_refund_lines_v2 (
      refund_line_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      selection_canonical TEXT,
      refund_scope TEXT NOT NULL,
      refund_yen_per_100 INTEGER
    );
    CREATE TABLE settlement_source_duplicate_resolutions_v2 (
      duplicate_observation_id TEXT
    );
  `);
  return db;
}

function insertCandidate(
  db: DatabaseSync,
  input: {
    id: string;
    raceKey?: string;
    supersedes?: string | null;
    integrity?: string;
    security?: string;
    replayEligible?: number;
    payout?: number;
  },
): void {
  const raceKey = input.raceKey ?? "2026-05-01:01:R1";
  const rawId = `raw-${input.id}`;
  const parseId = `parse-${input.id}`;
  const observationId = `obs-${input.id}`;
  db.prepare("INSERT INTO raw_documents VALUES (?,?,?,?)").run(
    rawId,
    input.integrity ?? "verified",
    input.security ?? "passed",
    input.replayEligible ?? 1,
  );
  db.prepare("INSERT INTO parse_runs VALUES (?,?,?)").run(parseId, rawId, "success");
  db.prepare("INSERT INTO domain_observations VALUES (?,?,?,?,?,?)").run(
    observationId,
    raceKey,
    "settlement_result",
    "settlement_result",
    rawId,
    parseId,
  );
  db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?)").run(
    input.id,
    raceKey,
    "trifecta",
    "settled",
    "resolved",
    observationId,
    parseId,
    rawId,
    input.supersedes ?? null,
  );
  db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?)").run(
    `payout-${input.id}`,
    input.id,
    1,
    "trifecta",
    "1-2-3",
    input.payout ?? 1000,
    "payout",
  );
}

test("selection profile excludes superseded settlement candidates", () => {
  const db = makeDb();
  try {
    insertCandidate(db, { id: "old", payout: 900 });
    insertCandidate(db, { id: "new", supersedes: "old", payout: 1200 });

    const profile = readN2SelectionProfileSource(db, "2026-05");

    assert.equal(profile.candidateCount, 1);
    assert.equal(profile.eligibleCandidateCount, 1);
    assert.equal(profile.byBetType.trifecta.candidates, 1);
    assert.equal(profile.byBetType.trifecta.positivePayoutYenPer100.max, 1200);
  } finally {
    db.close();
  }
});

test("selection profile rejects tainted raw lineage for an eligible label", () => {
  for (const raw of [
    { integrity: "quarantined", security: "passed", replayEligible: 1 },
    { integrity: "verified", security: "quarantined", replayEligible: 1 },
    { integrity: "verified", security: "passed", replayEligible: 0 },
  ]) {
    const db = makeDb();
    try {
      insertCandidate(db, { id: "active", ...raw });
      assert.throws(
        () => readN2SelectionProfileSource(db, "2026-05"),
        /N2_SELECTION_PROFILE_SETTLEMENT_LINEAGE_INVALID:active/u,
      );
    } finally {
      db.close();
    }
  }
});

test("selection profile rejects payout lines from another bet type", () => {
  const db = makeDb();
  try {
    insertCandidate(db, { id: "active" });
    db.prepare("UPDATE race_payout_lines_v2 SET bet_type='win' WHERE candidate_id='active'").run();
    assert.throws(
      () => readN2SelectionProfileSource(db, "2026-05"),
      /N2_SELECTION_PROFILE_PAYOUT_BET_LINEAGE_INVALID:active/u,
    );
  } finally {
    db.close();
  }
});

test("selection profile rejects refund lines from another bet type", () => {
  const db = makeDb();
  try {
    insertCandidate(db, { id: "active" });
    db.prepare("INSERT INTO race_refund_lines_v2 VALUES (?,?,?,?,?,?,?)").run(
      "refund-active",
      "active",
      1,
      "win",
      "1",
      "selection",
      100,
    );
    assert.throws(
      () => readN2SelectionProfileSource(db, "2026-05"),
      /N2_SELECTION_PROFILE_REFUND_BET_LINEAGE_INVALID:active/u,
    );
  } finally {
    db.close();
  }
});
