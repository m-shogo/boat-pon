import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { settlementCandidateSemanticHashValid } from "./n1SettlementCandidateSemanticHash";

test("settlement semantic hash fails closed when current authority markers exist without revision lineage", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE settlement_candidates_v2(
        candidate_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        supersedes_candidate_id TEXT,
        source_kind TEXT NOT NULL
      );
      CREATE TABLE race_payout_lines_v2(
        payout_line_id TEXT PRIMARY KEY,
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
      CREATE TABLE race_refund_lines_v2(
        refund_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT,
        selection_normalized TEXT,
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
      INSERT INTO settlement_candidates_v2
        (candidate_id,canonical_race_key,bet_type,settlement_status,result_kind,semantic_hash,supersedes_candidate_id,source_kind)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      "candidate",
      "2026-05-01:01:R1",
      "trifecta",
      "settled",
      "normal",
      semanticHash,
      null,
      "official_result",
    );
    db.prepare(`
      INSERT INTO race_payout_lines_v2
        (payout_line_id,candidate_id,line_no,bet_type,selection_raw,selection_normalized,selection_canonical,payout_yen,popularity,line_kind)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run("payout", "candidate", 1, "trifecta", "1-2-3", "1-2-3", "1-2-3", 1000, 1, "payout");

    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});
