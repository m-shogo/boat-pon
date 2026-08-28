import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

function fixture(resolutionStatus: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE settlement_candidates_v2 (
      candidate_id TEXT PRIMARY KEY,
      bet_type TEXT NOT NULL,
      settlement_status TEXT NOT NULL,
      result_kind TEXT NOT NULL,
      resolution_status TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?)")
    .run("candidate", "trifecta", "settled", "normal", resolutionStatus);
  return db;
}

for (const status of ["resolved", "source_conflict", "unresolved", "quarantined"] as const) {
  test(`source duplicate candidate semantics accept canonical resolution status ${status}`, () => {
    const db = fixture(status);
    try {
      assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), true);
    } finally {
      db.close();
    }
  });
}

test("source duplicate candidate semantics reject producer-impossible resolution status", () => {
  const db = fixture("producer_impossible");
  try {
    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});
