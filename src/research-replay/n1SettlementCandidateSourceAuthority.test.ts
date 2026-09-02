import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { settlementCandidateSemanticHashValid } from "./n1SettlementCandidateSemanticHash";

const NOW = "2026-07-24T03:00:00.000Z";

function fixture(sourceKind: string, sourceSchemaVersion: string): DatabaseSync {
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
  const payouts = [["1-2", 500, null, "payout"]];
  const semanticHash = canonicalHash({
    betType: "exacta",
    settlementStatus: "settled",
    resultKind: "normal",
    payouts,
    refunds: [],
  });
  db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    "candidate", "2026-07-24:01:R1", "exacta", "settled", "normal", "initial", "resolved",
    sourceKind, sourceSchemaVersion, "observation", "parse", "raw", semanticHash,
    null, null, NOW, NOW,
  );
  db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?,?,?)").run(
    "candidate", 1, "exacta", "1-2", "1-2", "1-2", 500, null, "payout",
  );
  return db;
}

test("settlement semantic validator accepts canonical current source authority", () => {
  const db = fixture("official_archive", "legacy_pre_trifecta");
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), true);
  } finally {
    db.close();
  }
});

test("settlement semantic validator rejects blank current source kind", () => {
  const db = fixture("   ", "legacy_pre_trifecta");
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});

test("settlement semantic validator rejects blank current source schema version", () => {
  const db = fixture("official_archive", "   ");
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});

test("settlement semantic validator rejects noncanonical current source authority whitespace", () => {
  for (const [sourceKind, sourceSchemaVersion] of [
    [" official_archive", "legacy_pre_trifecta"],
    ["official_archive ", "legacy_pre_trifecta"],
    ["official_archive", " legacy_pre_trifecta"],
    ["official_archive", "legacy_pre_trifecta "],
  ] as const) {
    const db = fixture(sourceKind, sourceSchemaVersion);
    try {
      assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
    } finally {
      db.close();
    }
  }
});
