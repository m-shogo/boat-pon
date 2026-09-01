import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { settlementCandidateSemanticHashValid } from "./n1SettlementCandidateSemanticHash";

test("settlement semantic hash validation fails closed when authority tables are missing", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        semantic_hash TEXT NOT NULL
      );
    `);
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});

test("settlement semantic hash validation fails closed when required authority columns are missing", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        semantic_hash TEXT NOT NULL
      );
      CREATE TABLE race_payout_lines_v2 (
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        selection_canonical TEXT,
        payout_yen INTEGER NOT NULL,
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
    `);
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});
