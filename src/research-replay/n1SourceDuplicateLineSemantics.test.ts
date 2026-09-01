import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

function fixture(): DatabaseSync {
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
  db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?,?)")
    .run("candidate", 1, "trifecta", "1-2-3", "1-2-3", "1-2-3", 1000, "payout");
  return db;
}

function legacyFixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE race_payout_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      selection_canonical TEXT
    );
    CREATE TABLE race_refund_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      selection_canonical TEXT
    );
  `);
  return db;
}

test("source duplicate line semantics accept producer-valid payout evidence", () => {
  const db = fixture();
  try {
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), true);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics accept producer-valid special payout with noncanonical selection", () => {
  const db = fixture();
  try {
    db.prepare(`
      UPDATE race_payout_lines_v2
      SET selection_raw='9-9-9', selection_normalized='9-9-9', selection_canonical=NULL, line_kind='special_payout'
      WHERE candidate_id='candidate'
    `).run();
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), true);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics reject special payout normalization drift", () => {
  const db = fixture();
  try {
    db.prepare(`
      UPDATE race_payout_lines_v2
      SET selection_raw='9>9>9', selection_normalized='9>9>9', selection_canonical=NULL, line_kind='special_payout'
      WHERE candidate_id='candidate'
    `).run();
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics reject raw/normalized/canonical drift", () => {
  const db = fixture();
  try {
    db.prepare(`
      UPDATE race_payout_lines_v2
      SET selection_raw='2-1-3', selection_normalized='2-1-3'
      WHERE candidate_id='candidate'
    `).run();
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics reject cross-bet payout evidence", () => {
  const db = fixture();
  try {
    db.prepare("UPDATE race_payout_lines_v2 SET bet_type='exacta' WHERE candidate_id='candidate'").run();
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics reject impossible null-selection provenance", () => {
  const db = fixture();
  try {
    db.prepare(`
      UPDATE race_payout_lines_v2
      SET selection_canonical=NULL, selection_raw='1-2-3', selection_normalized='1-2-3'
      WHERE candidate_id='candidate'
    `).run();
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics reject negative payout amounts", () => {
  const db = fixture();
  try {
    db.prepare("UPDATE race_payout_lines_v2 SET payout_yen=-1 WHERE candidate_id='candidate'").run();
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics reject fractional payout amounts", () => {
  const db = fixture();
  try {
    db.prepare("UPDATE race_payout_lines_v2 SET payout_yen=1.5 WHERE candidate_id='candidate'").run();
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics reject unknown refund scopes", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO race_refund_lines_v2 VALUES (?,?,?,?,?,?,?,?)")
      .run("candidate", 1, "trifecta", "1-2-3", "1-2-3", "1-2-3", "unknown", 100);
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics reject fractional refund amounts", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO race_refund_lines_v2 VALUES (?,?,?,?,?,?,?,?)")
      .run("candidate", 1, "trifecta", "1-2-3", "1-2-3", "1-2-3", "selection", 1.5);
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics reject negative refund amounts", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO race_refund_lines_v2 VALUES (?,?,?,?,?,?,?,?)")
      .run("candidate", 1, "trifecta", "1-2-3", "1-2-3", "1-2-3", "selection", -1);
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics preserve fallback when a synthetic fixture omits one line table", () => {
  const db = fixture();
  try {
    db.exec("DROP TABLE race_refund_lines_v2");
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), true);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics preserve legacy fallback only when both line tables are legacy-shaped", () => {
  const db = legacyFixture();
  try {
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), true);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics fail closed when only payout schema is current", () => {
  const db = legacyFixture();
  try {
    db.exec("DROP TABLE race_payout_lines_v2");
    db.exec(`
      CREATE TABLE race_payout_lines_v2 (
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT,
        selection_normalized TEXT,
        selection_canonical TEXT
      );
    `);
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics fail closed when only refund schema is current", () => {
  const db = legacyFixture();
  try {
    db.exec("DROP TABLE race_refund_lines_v2");
    db.exec(`
      CREATE TABLE race_refund_lines_v2 (
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT,
        selection_normalized TEXT,
        selection_canonical TEXT
      );
    `);
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});

test("source duplicate line semantics fail closed when both line tables expose partial current identity authority", () => {
  const db = legacyFixture();
  try {
    db.exec("ALTER TABLE race_payout_lines_v2 ADD COLUMN bet_type TEXT");
    db.exec("ALTER TABLE race_refund_lines_v2 ADD COLUMN bet_type TEXT");
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});
