import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  detectExactDuplicateObservationsInRaw,
  planSourceDuplicateResolution,
} from "./n1CanonicalResolution";

const RACE_KEY = "2026-08-01:01:R1";
const RAW_ID = "raw-1";
const PARSE_ID = "parse-1";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
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
      revision_kind TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      semantic_hash TEXT NOT NULL,
      supersedes_candidate_id TEXT,
      correction_reason TEXT
    );
  `);
  db.prepare("INSERT INTO parse_runs VALUES (?,?,?)").run(PARSE_ID, RAW_ID, "success");
  db.prepare("INSERT INTO parse_runs VALUES (?,?,?)").run("parse-2", "raw-2", "success");
  const insertObservation = db.prepare("INSERT INTO domain_observations VALUES (?,?,?,?,?,?,?,?,?)");
  insertObservation.run("obs-canonical", RACE_KEY, "settlement_result", "settlement_result", RAW_ID, PARSE_ID, null, null, null);
  insertObservation.run("obs-duplicate", RACE_KEY, "settlement_result", "settlement_result", RAW_ID, PARSE_ID, null, null, null);
  const insertCandidate = db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?,?)");
  insertCandidate.run("candidate-canonical", RACE_KEY, "trifecta", "initial", "obs-canonical", PARSE_ID, RAW_ID, "same-semantic", null, null);
  insertCandidate.run("candidate-duplicate", RACE_KEY, "trifecta", "initial", "obs-duplicate", "parse-2", "raw-2", "same-semantic", null, null);
  return db;
}

test("source duplicate planner refuses candidate parse/raw lineage drift", () => {
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
