import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

function fixture(semanticHash: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
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
  db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?)")
    .run("candidate", "trifecta", "settled", "normal", semanticHash);
  db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?,?,?)")
    .run("candidate", 1, "trifecta", "1-2-3", "1-2-3", "1-2-3", 1000, 1, "payout");
  return db;
}

function canonicalSemanticHash(): string {
  return canonicalHash({
    betType: "trifecta",
    settlementStatus: "settled",
    resultKind: "normal",
    payouts: [["1-2-3", 1000, 1, "payout"]],
    refunds: [],
  });
}

test("source duplicate semantics accept canonical SHA-256-shaped candidate hashes", () => {
  const db = fixture(canonicalSemanticHash());
  try {
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), true);
  } finally {
    db.close();
  }
});

test("source duplicate semantics reject placeholder hashes on current-shaped settlement data", () => {
  const db = fixture("same-semantic");
  try {
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});
