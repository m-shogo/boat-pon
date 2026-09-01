import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

test("source duplicate line semantics reject current line ids on otherwise legacy-shaped tables", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE race_payout_lines_v2 (
        payout_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        selection_canonical TEXT
      );
      CREATE TABLE race_refund_lines_v2 (
        refund_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        selection_canonical TEXT
      );
    `);

    assert.equal(sourceDuplicateCandidateLineSemanticsValid(db, "candidate", "trifecta"), false);
  } finally {
    db.close();
  }
});
