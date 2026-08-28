import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE race_payout_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no,
      bet_type TEXT NOT NULL,
      selection_raw TEXT,
      selection_normalized TEXT,
      selection_canonical TEXT,
      payout_yen,
      popularity,
      line_kind TEXT
    );
    CREATE TABLE race_refund_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no,
      bet_type TEXT NOT NULL,
      selection_raw TEXT,
      selection_normalized TEXT,
      selection_canonical TEXT,
      refund_scope TEXT NOT NULL,
      refund_yen_per_100
    );
  `);
  return db;
}

function insertPayout(db: DatabaseSync, lineNo: number): void {
  db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?,?,?)")
    .run("candidate", lineNo, "trifecta", "1-2-3", "1-2-3", "1-2-3", 1000, 1, "payout");
}

test("settlement line semantics accept positive unique line numbers", () => {
  const db = fixture();
  try {
    insertPayout(db, 1);
    insertPayout(db, 2);
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), true);
  } finally {
    db.close();
  }
});

test("settlement line semantics reject non-positive payout line numbers", () => {
  const db = fixture();
  try {
    insertPayout(db, 0);
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("settlement line semantics reject fractional refund line numbers", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO race_refund_lines_v2 VALUES (?,?,?,?,?,?,?,?,?)")
      .run("candidate", 1.5, "trifecta", "1-2-3", "1-2-3", "1-2-3", "selection", 100);
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("settlement line semantics reject duplicate payout line numbers", () => {
  const db = fixture();
  try {
    insertPayout(db, 1);
    insertPayout(db, 1);
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});
