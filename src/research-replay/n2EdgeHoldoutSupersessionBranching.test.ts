import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2EdgeHoldoutSource } from "./n2EdgeHoldoutSource";

test("edge holdout source fails closed on branching supersession before reading primary metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-edge-holdout-branching-"));
  const sidecarDbPath = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(sidecarDbPath);
  const raceKey = "2024-08-01:05:R1";
  try {
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
        result_kind TEXT NOT NULL,
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
        selection_raw TEXT,
        selection_normalized TEXT,
        selection_canonical TEXT,
        line_kind TEXT NOT NULL
      );
      CREATE TABLE settlement_source_duplicate_resolutions_v2 (
        resolution_id TEXT PRIMARY KEY,
        duplicate_observation_id TEXT NOT NULL,
        canonical_observation_id TEXT NOT NULL,
        canonical_race_key TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        source_archive_file TEXT NOT NULL,
        resolution_kind TEXT NOT NULL,
        detection_reason TEXT NOT NULL,
        duplicate_semantic_digest TEXT NOT NULL,
        resolver_version TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        schema_version TEXT NOT NULL
      );

      INSERT INTO raw_documents VALUES ('raw-a','verified','passed',1);
      INSERT INTO parse_runs VALUES ('parse-a','raw-a','success');
      INSERT INTO domain_observations VALUES ('obs-a','2024-08-01:05:R1','settlement_result','settlement_result','raw-a','parse-a');
      INSERT INTO settlement_candidates_v2 VALUES ('ancestor','2024-08-01:05:R1','trifecta','settled','normal','resolved','obs-a','parse-a','raw-a',NULL);
      INSERT INTO settlement_candidates_v2 VALUES ('branch-a','2024-08-01:05:R1','trifecta','settled','normal','resolved','obs-a','parse-a','raw-a','ancestor');
      INSERT INTO settlement_candidates_v2 VALUES ('branch-b','2024-08-01:05:R1','trifecta','settled','normal','resolved','obs-a','parse-a','raw-a','ancestor');
    `);
    db.close();

    const result = readN2EdgeHoldoutSource({
      sidecarDbPath,
      primaryDbPath: join(root, "must-not-be-read.sqlite"),
    });

    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.blockers, [
      `${raceKey}:SETTLEMENT_SUPERSESSION_BRANCHING_INVALID:ancestor`,
    ]);
    assert.equal(result.reads.primaryDatabaseReadCount, 0);
    assert.equal(result.reads.sidecarDatabaseReadCount, 1);
    assert.deepEqual(result.historicalOutcomes, []);
    assert.deepEqual(result.candidates, []);
  } finally {
    try { db.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true });
  }
});
