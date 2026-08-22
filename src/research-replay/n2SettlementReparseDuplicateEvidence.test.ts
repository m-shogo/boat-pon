import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { loadSourceDuplicateSet } from "./n2SettlementReparseEngine";

function staleResolutionDb(): DatabaseSync {
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
      settlement_status TEXT NOT NULL,
      result_kind TEXT NOT NULL,
      revision_kind TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      semantic_hash TEXT NOT NULL,
      supersedes_candidate_id TEXT,
      correction_reason TEXT
    );
    CREATE TABLE race_payout_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      selection_canonical TEXT,
      payout_yen INTEGER NOT NULL,
      popularity INTEGER,
      line_kind TEXT NOT NULL
    );
    CREATE TABLE race_refund_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      selection_canonical TEXT,
      refund_scope TEXT NOT NULL,
      refund_yen_per_100 INTEGER,
      reason_code TEXT NOT NULL
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
  `);
  db.prepare(`INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "stale-resolution",
    "missing-duplicate",
    "missing-canonical",
    "2026-08-01:01:R1",
    "missing-raw",
    "k260801.lzh",
    "source_duplicate",
    "intra_file_source_duplicate: same raw document produced multiple identical race observations",
    "a".repeat(64),
    "n1c-source-duplicate-resolver-v1",
    "n1c-source-duplicate-policy-v1",
    "n1-settlement.0.3",
  );
  return db;
}

test("reparse source duplicate loading fails closed on stale append-only evidence", () => {
  const db = staleResolutionDb();
  try {
    assert.throws(
      () => loadSourceDuplicateSet(db),
      /SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID:missing-duplicate/,
    );
  } finally {
    db.close();
  }
});

test("reparse source duplicate loading remains empty when no resolution evidence exists", () => {
  const db = staleResolutionDb();
  try {
    db.prepare("DELETE FROM settlement_source_duplicate_resolutions_v2").run();
    assert.deepEqual([...loadSourceDuplicateSet(db)], []);
  } finally {
    db.close();
  }
});
