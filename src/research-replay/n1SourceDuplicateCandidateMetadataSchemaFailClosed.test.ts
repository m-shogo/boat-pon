import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

test("source duplicate candidate metadata validation rejects partial candidate authority", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL
      );
      CREATE TABLE race_payout_lines_v2 (
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT,
        selection_normalized TEXT,
        selection_canonical TEXT,
        payout_yen INTEGER NOT NULL,
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
        refund_yen_per_100 INTEGER
      );
      INSERT INTO settlement_candidates_v2 VALUES ('candidate', 'trifecta', 'settled');
      INSERT INTO race_payout_lines_v2 VALUES (
        'candidate', 1, 'trifecta', '1-2-3', '1-2-3', '1-2-3', 1000, 'payout'
      );
    `);

    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});
