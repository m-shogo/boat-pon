import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import {
  detectExactDuplicateObservationsInRaw,
  planSourceDuplicateResolution,
} from "./n1CanonicalResolution";

const RACE_KEY = "2026-08-01:01:R1";
const RAW_ID = "raw-1";
const PARSE_ID = "parse-1";

function semanticHash(payoutYen: number): string {
  return canonicalHash({
    betType: "trifecta",
    settlementStatus: "settled",
    resultKind: "normal",
    payouts: [["1-2-3", payoutYen, null, "payout"]],
    refunds: [],
  });
}

function fixture(): DatabaseSync {
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
      parse_run_id TEXT NOT NULL,
      supersedes_id TEXT,
      correction_kind TEXT,
      correction_reason TEXT
    );
    CREATE TABLE settlement_candidates_v2 (
      candidate_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      bet_type TEXT NOT NULL,
      settlement_status TEXT NOT NULL,
      result_kind TEXT NOT NULL,
      revision_kind TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      semantic_hash TEXT NOT NULL,
      supersedes_candidate_id TEXT,
      correction_reason TEXT
    );
    CREATE TABLE race_payout_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      selection_raw TEXT,
      selection_normalized TEXT,
      selection_canonical TEXT,
      payout_yen INTEGER NOT NULL,
      popularity INTEGER,
      line_kind TEXT NOT NULL
    );
    CREATE TABLE race_refund_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      selection_raw TEXT,
      selection_normalized TEXT,
      selection_canonical TEXT,
      refund_scope TEXT NOT NULL,
      refund_yen_per_100 INTEGER,
      reason_code TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO raw_documents VALUES (?,?,?,?)").run(RAW_ID, "verified", "passed", 1);
  db.prepare("INSERT INTO parse_runs VALUES (?,?,?)").run(PARSE_ID, RAW_ID, "success");
  const insertObservation = db.prepare("INSERT INTO domain_observations VALUES (?,?,?,?,?,?,?,?,?)");
  insertObservation.run("obs-canonical", RACE_KEY, "settlement_result", "settlement_result", RAW_ID, PARSE_ID, null, null, null);
  insertObservation.run("obs-duplicate", RACE_KEY, "settlement_result", "settlement_result", RAW_ID, PARSE_ID, null, null, null);

  const storedHash = semanticHash(4200);
  const insertCandidate = db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  insertCandidate.run("candidate-canonical", RACE_KEY, "trifecta", "settled", "normal", "initial", "obs-canonical", PARSE_ID, RAW_ID, storedHash, null, null);
  insertCandidate.run("candidate-duplicate", RACE_KEY, "trifecta", "settled", "normal", "initial", "obs-duplicate", PARSE_ID, RAW_ID, storedHash, null, null);
  const insertPayout = db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?,?,?)");
  insertPayout.run("candidate-canonical", 1, "trifecta", "1-2-3", "1-2-3", "1-2-3", 4200, null, "payout");
  insertPayout.run("candidate-duplicate", 1, "trifecta", "1-2-3", "1-2-3", "1-2-3", 4300, null, "payout");
  return db;
}

test("source duplicate producer rejects stored semantic hashes that do not match persisted lines", () => {
  const db = fixture();
  try {
    const plan = planSourceDuplicateResolution(db);
    assert.equal(plan.plannedResolutions.length, 0);
    assert.equal(plan.valueConflicts.length, 1);
    assert.equal(plan.valueConflicts[0].duplicateObservationId, "obs-duplicate");

    const future = detectExactDuplicateObservationsInRaw(db, RAW_ID);
    assert.equal(future.length, 1);
    assert.equal(future[0].valueEqual, false);
  } finally {
    db.close();
  }
});

test("source duplicate producer rejects raw/normalized line drift before planning append-only evidence", () => {
  const db = fixture();
  try {
    db.prepare(`
      UPDATE race_payout_lines_v2
      SET payout_yen=4200, selection_raw='2-1-3', selection_normalized='2-1-3'
      WHERE candidate_id='candidate-duplicate'
    `).run();

    const plan = planSourceDuplicateResolution(db);
    assert.equal(plan.plannedResolutions.length, 0);
    assert.equal(plan.valueConflicts.length, 1);
    assert.equal(plan.valueConflicts[0].duplicateObservationId, "obs-duplicate");

    const future = detectExactDuplicateObservationsInRaw(db, RAW_ID);
    assert.equal(future.length, 1);
    assert.equal(future[0].valueEqual, false);
  } finally {
    db.close();
  }
});
