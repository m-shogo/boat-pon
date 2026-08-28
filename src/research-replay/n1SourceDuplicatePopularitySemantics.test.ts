import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

function fixture(popularity: number | null): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE race_payout_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      selection_raw TEXT,
      selection_normalized TEXT,
      selection_canonical TEXT,
      payout_yen INTEGER NOT NULL,
      popularity,
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
  `);
  db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?,?,?)").run(
    "candidate",
    1,
    "trifecta",
    "1-2-3",
    "1-2-3",
    "1-2-3",
    1000,
    popularity,
    "payout",
  );
  return db;
}

function legacyCurrentFixtureWithoutPopularity(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
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
  `);
  db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?,?)").run(
    "candidate", 1, "trifecta", "1-2-3", "1-2-3", "1-2-3", 1000, "payout",
  );
  return db;
}

test("source duplicate line semantics accept null or positive safe-integer popularity", () => {
  for (const popularity of [null, 1, 120]) {
    const db = fixture(popularity);
    try {
      assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), true);
    } finally {
      db.close();
    }
  }
});

test("source duplicate line semantics reject producer-impossible popularity values", () => {
  for (const popularity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const db = fixture(popularity);
    try {
      assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
    } finally {
      db.close();
    }
  }
});

test("source duplicate line semantics preserve the pre-popularity synthetic fixture fallback", () => {
  const db = legacyCurrentFixtureWithoutPopularity();
  try {
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), true);
  } finally {
    db.close();
  }
});
