import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { settlementCandidateSemanticHashValid } from "./n1SettlementCandidateSemanticHash";

const RACE_KEY = "2026-08-01:01:R1";
const NOW = "2026-08-01T12:00:00.000Z";

type FixtureOptions = {
  settlementStatus: "settled" | "refunded" | "partially_refunded";
  payout: boolean;
  refund: boolean;
};

function fixture({ settlementStatus, payout, refund }: FixtureOptions): DatabaseSync {
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
      refund_yen_per_100 INTEGER,
      reason_code TEXT NOT NULL
    );
  `);

  const payouts = payout ? [["1-2-3", 1000, 1, "payout"]] : [];
  const refunds = refund ? [[null, "bet_type", 100, "ARCHIVE_RETURNED"]] : [];
  const semanticHash = canonicalHash({
    betType: "trifecta",
    settlementStatus,
    resultKind: "normal",
    payouts,
    refunds,
  });
  db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      "candidate", RACE_KEY, "trifecta", settlementStatus, "normal", "initial", "resolved",
      "official_archive", "modern_seven_display", "obs-1", "parse-1", "raw-1", semanticHash,
      null, null, NOW, NOW,
    );
  if (payout) {
    db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?,?,?)")
      .run("candidate", 1, "trifecta", "1-2-3", "1-2-3", "1-2-3", 1000, 1, "payout");
  }
  if (refund) {
    db.prepare("INSERT INTO race_refund_lines_v2 VALUES (?,?,?,?,?,?,?,?,?)")
      .run("candidate", 1, "trifecta", null, null, null, "bet_type", 100, "ARCHIVE_RETURNED");
  }
  return db;
}

for (const [name, options] of [
  ["settled without payout", { settlementStatus: "settled", payout: false, refund: false }],
  ["settled with refund", { settlementStatus: "settled", payout: true, refund: true }],
  ["refunded with payout", { settlementStatus: "refunded", payout: true, refund: true }],
  ["partially refunded without refund", { settlementStatus: "partially_refunded", payout: true, refund: false }],
  ["partially refunded without payout", { settlementStatus: "partially_refunded", payout: false, refund: true }],
] as const) {
  test(`settlement semantic validation rejects ${name}`, () => {
    const db = fixture(options);
    try {
      assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
    } finally {
      db.close();
    }
  });
}

test("settlement semantic validation accepts producer-consistent partial refund lines", () => {
  const db = fixture({ settlementStatus: "partially_refunded", payout: true, refund: true });
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), true);
  } finally {
    db.close();
  }
});
