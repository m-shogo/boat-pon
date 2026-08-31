import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { settlementCandidateSemanticHashValid } from "./n1SettlementCandidateSemanticHash";

const RACE = "2026-07-24:01:R1";

function fixture(
  revisionKind: string,
  supersedesCandidateId: string | null = revisionKind === "initial" ? null : "prior-candidate",
  correctionReason: string | null = revisionKind === "initial" ? null : "research-correction",
  supersededRaceKey = RACE,
  supersededBetType = "trifecta",
): DatabaseSync {
  const db = new DatabaseSync(":memory:");
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
  if (supersedesCandidateId && supersedesCandidateId !== "candidate") {
    db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?)")
      .run(
        supersedesCandidateId, supersededRaceKey, supersededBetType, "settled", "normal", "initial",
        null, null, semanticHash,
      );
  }
  db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?)")
    .run(
      "candidate", RACE, "trifecta", "settled", "normal", revisionKind,
      supersedesCandidateId, correctionReason, semanticHash,
    );
  return db;
}

for (const revisionKind of ["initial", "official_correction", "parser_reparse", "source_revision"] as const) {
  test(`settlement candidate semantic authority accepts canonical revision kind ${revisionKind}`, () => {
    const db = fixture(revisionKind);
    try {
      assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), true);
    } finally {
      db.close();
    }
  });
}

test("settlement candidate semantic authority rejects producer-impossible revision kind", () => {
  const db = fixture("producer_impossible");
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});

test("initial settlement candidate cannot supersede another candidate", () => {
  const db = fixture("initial", "prior-candidate", null);
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});

test("initial settlement candidate cannot carry a correction reason", () => {
  const db = fixture("initial", null, "research-correction");
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});

test("revised settlement candidate requires a superseded candidate", () => {
  const db = fixture("parser_reparse", null, "research-correction");
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});

test("revised settlement candidate requires a correction reason", () => {
  const db = fixture("official_correction", "prior-candidate", null);
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});

test("revised settlement candidate cannot supersede itself", () => {
  const db = fixture("source_revision", "candidate", "research-correction");
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});

test("revised settlement candidate cannot supersede a different race", () => {
  const db = fixture("parser_reparse", "prior-candidate", "research-correction", "2026-07-24:01:R2");
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});

test("revised settlement candidate cannot supersede a different bet type", () => {
  const db = fixture("source_revision", "prior-candidate", "research-correction", RACE, "trio");
  try {
    assert.equal(settlementCandidateSemanticHashValid(db, "candidate"), false);
  } finally {
    db.close();
  }
});
