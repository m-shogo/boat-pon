import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

test("source duplicate semantics reject current candidate authority when a current line table is missing", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
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
      INSERT INTO settlement_candidates_v2 VALUES (
        'candidate', '2026-08-01:01:R1', 'trifecta', 'settled', 'normal', 'initial', 'resolved',
        'official_result', 'n1-settlement.0.1', 'obs', 'parse', 'raw',
        '0000000000000000000000000000000000000000000000000000000000000000',
        NULL, NULL, '2026-08-01T04:00:00.000Z', '2026-08-01T04:00:00.000Z'
      );
    `);

    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});
