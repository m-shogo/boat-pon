import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

const RACE_KEY = "2026-08-01:01:R1";

function fixture(semanticHash: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
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
      refund_yen_per_100 INTEGER,
      reason_code TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      "candidate", RACE_KEY, "trifecta", "settled", "normal", "initial", "resolved",
      "official_archive", "k-family", "obs-1", "parse-1", "raw-1", semanticHash,
      null, null, "2026-08-01T12:00:00.000Z", "2026-08-01T12:00:00.000Z",
    );
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
