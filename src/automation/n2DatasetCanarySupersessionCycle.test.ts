import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  preflightN2AllActiveSettlementLineage,
  preflightN2DatasetCanarySettlementLineage,
} from "./n2DatasetCanarySettlementGuard";

const FIXTURE_TIME = "2024-06-05T03:00:00.000Z";

test("dataset settlement preflight rejects a supersession cycle before active filtering can hide every member", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-supersession-cycle-"));
  const path = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(path);
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
        revision_kind TEXT NOT NULL,
        resolution_status TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_schema_version TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        supersedes_candidate_id TEXT,
        correction_reason TEXT,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE race_payout_lines_v2 (
        payout_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT NOT NULL,
        selection_normalized TEXT NOT NULL,
        selection_canonical TEXT,
        payout_yen INTEGER NOT NULL,
        popularity INTEGER,
        line_kind TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE race_refund_lines_v2 (
        refund_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT,
        selection_normalized TEXT,
        selection_canonical TEXT,
        refund_scope TEXT NOT NULL,
        refund_yen_per_100 INTEGER,
        reason_code TEXT NOT NULL,
        created_at TEXT NOT NULL
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
        schema_version TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(`INSERT INTO settlement_candidates_v2 VALUES
      ('cycle-a','2024-06-05:12:R1','trifecta','settled','normal','source_revision','resolved','official','fixture-v1',
       'obs-a','parse-a','raw-a',?,'cycle-b','cycle fixture a',?,?)`)
      .run("a".repeat(64), FIXTURE_TIME, FIXTURE_TIME);
    db.prepare(`INSERT INTO settlement_candidates_v2 VALUES
      ('cycle-b','2024-06-05:12:R1','trifecta','settled','normal','source_revision','resolved','official','fixture-v1',
       'obs-b','parse-b','raw-b',?,'cycle-a','cycle fixture b',?,?)`)
      .run("b".repeat(64), FIXTURE_TIME, FIXTURE_TIME);
  } finally {
    db.close();
  }

  try {
    const canary = preflightN2DatasetCanarySettlementLineage(path);
    assert.equal(canary.ok, false);
    assert.equal(canary.checkedCandidateCount, 0);
    assert.deepEqual(canary.blocks, [
      "DATASET_CANARY_SETTLEMENT_SUPERSESSION_CYCLE:cycle-a",
      "DATASET_CANARY_SETTLEMENT_SUPERSESSION_CYCLE:cycle-b",
    ]);

    const active = preflightN2AllActiveSettlementLineage(path);
    assert.equal(active.ok, false);
    assert.equal(active.checkedCandidateCount, 0);
    assert.deepEqual(active.blocks, [
      "DATASET_ACTIVE_SETTLEMENT_SUPERSESSION_CYCLE:cycle-a",
      "DATASET_ACTIVE_SETTLEMENT_SUPERSESSION_CYCLE:cycle-b",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});