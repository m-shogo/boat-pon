import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2SelectionProfileSource } from "./n2SelectionProfileSource";

test("selection profile rejects multiple unrelated active candidates for one race and bet", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
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
      CREATE TABLE parse_runs (parse_run_id TEXT PRIMARY KEY,raw_document_id TEXT NOT NULL,status TEXT NOT NULL);
      CREATE TABLE raw_documents (raw_document_id TEXT PRIMARY KEY,integrity_status TEXT NOT NULL,security_scan_status TEXT NOT NULL,parser_replay_eligible INTEGER NOT NULL);
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        revision_kind TEXT NOT NULL,
        resolution_status TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        supersedes_candidate_id TEXT,
        correction_reason TEXT,
        semantic_hash TEXT NOT NULL
      );
      CREATE TABLE race_payout_lines_v2 (
        payout_line_id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL,line_no INTEGER NOT NULL,bet_type TEXT NOT NULL,
        selection_raw TEXT,selection_normalized TEXT,selection_canonical TEXT,payout_yen INTEGER NOT NULL,popularity INTEGER,line_kind TEXT NOT NULL
      );
      CREATE TABLE race_refund_lines_v2 (
        refund_line_id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL,line_no INTEGER NOT NULL,bet_type TEXT NOT NULL,
        selection_raw TEXT,selection_normalized TEXT,selection_canonical TEXT,refund_scope TEXT NOT NULL,refund_yen_per_100 INTEGER,reason_code TEXT NOT NULL
      );
      CREATE TABLE settlement_source_duplicate_resolutions_v2 (
        resolution_id TEXT PRIMARY KEY,duplicate_observation_id TEXT NOT NULL,canonical_observation_id TEXT NOT NULL,
        canonical_race_key TEXT NOT NULL,raw_document_id TEXT NOT NULL,source_archive_file TEXT NOT NULL,
        resolution_kind TEXT NOT NULL,detection_reason TEXT NOT NULL,duplicate_semantic_digest TEXT NOT NULL,
        resolver_version TEXT NOT NULL,policy_version TEXT NOT NULL,schema_version TEXT NOT NULL
      );
    `);
    const insert = db.prepare(`
      INSERT INTO settlement_candidates_v2
      (candidate_id,canonical_race_key,bet_type,settlement_status,result_kind,revision_kind,resolution_status,
       observation_id,parse_run_id,raw_document_id,supersedes_candidate_id,correction_reason,semantic_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const raceKey = "2026-08-07:10:R1";
    insert.run("initial-a", raceKey, "trifecta", "settled", "normal", "initial", "resolved", "obs-a", "parse-a", "raw-a", null, null, "a".repeat(64));
    insert.run("initial-b", raceKey, "trifecta", "settled", "normal", "initial", "resolved", "obs-b", "parse-b", "raw-b", null, null, "b".repeat(64));

    assert.throws(
      () => readN2SelectionProfileSource(db, "2026-08"),
      /N2_SELECTION_PROFILE_ACTIVE_CANDIDATE_COUNT_INVALID:2026-08-07:10:R1:trifecta/u,
    );
  } finally {
    db.close();
  }
});
