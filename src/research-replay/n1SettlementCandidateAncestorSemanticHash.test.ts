import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { settlementCandidateSemanticHashValid } from "./n1SettlementCandidateSemanticHash";

const RACE = "2026-07-24:01:R1";

test("revised settlement candidate rejects a tampered predecessor semantic hash", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        revision_kind TEXT NOT NULL,
        supersedes_candidate_id TEXT,
        correction_reason TEXT,
        semantic_hash TEXT NOT NULL
      );
      CREATE TABLE race_payout_lines_v2 (
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        selection_canonical TEXT,
        payout_yen INTEGER NOT NULL,
        popularity INTEGER,
        line_kind TEXT
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

    const semanticHash = canonicalHash({
      betType: "trifecta",
      settlementStatus: "settled",
      resultKind: "normal",
      payouts: [],
      refunds: [],
    });
    const insert = db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?)");
    insert.run(
      "predecessor",
      RACE,
      "trifecta",
      "settled",
      "normal",
      "initial",
      null,
      null,
      "0".repeat(64),
    );
    insert.run(
      "candidate",
      RACE,
      "trifecta",
      "settled",
      "normal",
      "official_correction",
      "predecessor",
      "official correction",
      semanticHash,
    );

    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});
