import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { settlementCandidateSemanticHashValid } from "./n1SettlementCandidateSemanticHash";

test("current settlement candidates reject legacy payout/refund identity authority", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE settlement_candidates_v2(
        candidate_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        revision_kind TEXT NOT NULL,
        resolution_status TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_schema_version TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        supersedes_candidate_id TEXT,
        correction_reason TEXT,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE race_payout_lines_v2(
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        selection_canonical TEXT,
        payout_yen INTEGER NOT NULL,
        popularity INTEGER,
        line_kind TEXT
      );
      CREATE TABLE race_refund_lines_v2(
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        selection_canonical TEXT,
        refund_scope TEXT NOT NULL,
        refund_yen_per_100 INTEGER,
        reason_code TEXT
      );
    `);

    const semanticHash = canonicalHash({
      betType: "trifecta",
      settlementStatus: "settled",
      resultKind: "normal",
      payouts: [["1-2-3", 1000, 1, "payout"]],
      refunds: [],
    });
    db.prepare(`
      INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      "candidate",
      "2026-05-01:01:R1",
      "trifecta",
      "settled",
      "normal",
      "initial",
      "resolved",
      "official_result",
      "n1-settlement.0.1",
      semanticHash,
      null,
      null,
      "2026-05-01T10:00:00+09:00",
      "2026-05-01T10:00:00+09:00",
    );
    db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?)")
      .run("candidate", 1, "1-2-3", 1000, 1, "payout");

    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});
