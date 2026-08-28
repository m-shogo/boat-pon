import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

function fixture(settlementStatus: string, resultKind: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE settlement_candidates_v2 (
      candidate_id TEXT PRIMARY KEY,
      bet_type TEXT NOT NULL,
      settlement_status TEXT NOT NULL,
      result_kind TEXT NOT NULL
    );
    CREATE TABLE race_payout_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      selection_raw TEXT,
      selection_normalized TEXT,
      selection_canonical TEXT,
      payout_yen INTEGER NOT NULL,
      popularity INTEGER,
      line_kind TEXT
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
  `);
  db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?)")
    .run("candidate", "trifecta", settlementStatus, resultKind);
  db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?,?,?)")
    .run("candidate", 1, "trifecta", "1-2-3", "1-2-3", "1-2-3", 1000, 1, "payout");
  return db;
}

test("source duplicate candidate semantics accept canonical metadata enums", () => {
  const db = fixture("settled", "normal");
  try {
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), true);
  } finally {
    db.close();
  }
});

test("source duplicate candidate semantics reject impossible settlement status", () => {
  const db = fixture("producer_impossible", "normal");
  try {
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate candidate semantics reject impossible result kind", () => {
  const db = fixture("settled", "producer_impossible");
  try {
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});
