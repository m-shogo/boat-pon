import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2SelectionProfileSource } from "./n2SelectionProfileSource";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE raw_documents(raw_document_id TEXT PRIMARY KEY,integrity_status TEXT,security_scan_status TEXT,parser_replay_eligible INTEGER);
    CREATE TABLE parse_runs(parse_run_id TEXT PRIMARY KEY,raw_document_id TEXT,status TEXT);
    CREATE TABLE domain_observations(observation_id TEXT PRIMARY KEY,canonical_race_key TEXT,observation_type TEXT,payload_type TEXT,raw_document_id TEXT,parse_run_id TEXT);
    CREATE TABLE settlement_candidates_v2(candidate_id TEXT PRIMARY KEY,canonical_race_key TEXT,bet_type TEXT,settlement_status TEXT,resolution_status TEXT,observation_id TEXT,parse_run_id TEXT,raw_document_id TEXT,supersedes_candidate_id TEXT);
    CREATE TABLE race_payout_lines_v2(payout_line_id TEXT PRIMARY KEY,candidate_id TEXT,line_no INTEGER,bet_type TEXT,selection_raw TEXT,selection_normalized TEXT,selection_canonical TEXT,payout_yen INTEGER,line_kind TEXT);
    CREATE TABLE race_refund_lines_v2(refund_line_id TEXT PRIMARY KEY,candidate_id TEXT,line_no INTEGER,bet_type TEXT,selection_raw TEXT,selection_normalized TEXT,selection_canonical TEXT,refund_scope TEXT,refund_yen_per_100 INTEGER);
    CREATE TABLE settlement_source_duplicate_resolutions_v2(duplicate_observation_id TEXT);
  `);
  db.prepare("INSERT INTO raw_documents VALUES ('raw','verified','passed',1)").run();
  db.prepare("INSERT INTO parse_runs VALUES ('parse','raw','success')").run();
  db.prepare("INSERT INTO domain_observations VALUES ('obs','2026-05-01:01:R1','settlement_result','settlement_result','raw','parse')").run();
  db.prepare("INSERT INTO settlement_candidates_v2 VALUES ('candidate','2026-05-01:01:R1','trifecta','settled','resolved','obs','parse','raw',NULL)").run();
  db.prepare("INSERT INTO race_payout_lines_v2 VALUES ('payout','candidate',1,'trifecta','1-2-3','1-2-3','1-2-3',1000,'payout')").run();
  return db;
}

test("selection profile rejects producer-impossible candidate bet types", () => {
  const db = fixture();
  try {
    db.prepare("UPDATE settlement_candidates_v2 SET bet_type='unknown' WHERE candidate_id='candidate'").run();
    assert.throws(
      () => readN2SelectionProfileSource(db, "2026-05"),
      /N2_SELECTION_PROFILE_BET_TYPE_INVALID:candidate/u,
    );
  } finally {
    db.close();
  }
});

test("selection profile rejects producer-impossible settlement statuses", () => {
  const db = fixture();
  try {
    db.prepare("UPDATE settlement_candidates_v2 SET settlement_status='unknown' WHERE candidate_id='candidate'").run();
    assert.throws(
      () => readN2SelectionProfileSource(db, "2026-05"),
      /N2_SELECTION_PROFILE_SETTLEMENT_STATUS_INVALID:candidate/u,
    );
  } finally {
    db.close();
  }
});

test("selection profile rejects producer-impossible resolution statuses", () => {
  const db = fixture();
  try {
    db.prepare("UPDATE settlement_candidates_v2 SET resolution_status='unknown' WHERE candidate_id='candidate'").run();
    assert.throws(
      () => readN2SelectionProfileSource(db, "2026-05"),
      /N2_SELECTION_PROFILE_RESOLUTION_STATUS_INVALID:candidate/u,
    );
  } finally {
    db.close();
  }
});
