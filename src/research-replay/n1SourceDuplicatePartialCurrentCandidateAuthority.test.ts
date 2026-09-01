import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

test("source duplicate candidate validation rejects partial current candidate authority", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        source_kind TEXT NOT NULL
      );
      INSERT INTO settlement_candidates_v2 VALUES (
        'candidate', 'trifecta', 'settled', 'normal', 'legacy-placeholder', 'official_archive'
      );
    `);

    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});
