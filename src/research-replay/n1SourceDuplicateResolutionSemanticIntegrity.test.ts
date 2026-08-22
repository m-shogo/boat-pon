import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import {
  SOURCE_DUPLICATE_POLICY_VERSION,
  SOURCE_DUPLICATE_RESOLVER_VERSION,
} from "./n1CanonicalResolution";
import { readCurrentlyValidSourceDuplicateObservationIds } from "./n1SourceDuplicateResolutionValidation";
import { N1_CANONICAL_RESOLUTION_SCHEMA_VERSION } from "./settlement";

const RACE_KEY = "2026-08-01:01:R1";
const RAW_ID = "raw-1";
const PARSE_ID = "parse-1";
const CANONICAL_OBSERVATION = "obs-canonical";
const DUPLICATE_OBSERVATION = "obs-duplicate";
const DETECTION_REASON =
  "intra_file_source_duplicate: same raw document produced multiple identical race observations";

function candidateSemanticHash(payoutYen: number): string {
  return canonicalHash({
    betType: "trifecta",
    settlementStatus: "settled",
    resultKind: "normal",
    payouts: [["1-2-3", payoutYen, null, "payout"]],
    refunds: [],
  });
}

function createFixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE parse_runs (
      parse_run_id TEXT PRIMARY KEY,
      raw_document_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE domain_observations (
      observation_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      observation_type TEXT NOT NULL,
      payload_type TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      supersedes_id TEXT,
      correction_kind TEXT,
      correction_reason TEXT
    );
    CREATE TABLE settlement_candidates_v2 (
      candidate_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      bet_type TEXT NOT NULL,
      settlement_status TEXT NOT NULL,
      result_kind TEXT NOT NULL,
      revision_kind TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      semantic_hash TEXT NOT NULL,
      supersedes_candidate_id TEXT,
      correction_reason TEXT
    );
    CREATE TABLE race_payout_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      selection_canonical TEXT,
      payout_yen INTEGER NOT NULL,
      popularity INTEGER,
      line_kind TEXT NOT NULL
    );
    CREATE TABLE race_refund_lines_v2 (
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      selection_canonical TEXT,
      refund_scope TEXT NOT NULL,
      refund_yen_per_100 INTEGER,
      reason_code TEXT NOT NULL
    );
    CREATE TABLE settlement_source_duplicate_resolutions_v2 (
      resolution_id TEXT NOT NULL,
      duplicate_observation_id TEXT NOT NULL,
      canonical_observation_id TEXT NOT NULL,
      canonical_race_key TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      source_archive_file TEXT NOT NULL,
      resolution_kind TEXT NOT NULL,
      detection_reason TEXT NOT NULL,
      duplicate_semantic_digest TEXT NOT NULL,
      resolver_version TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      schema_version TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO parse_runs VALUES (?,?,?)").run(PARSE_ID, RAW_ID, "success");
  const insertObservation = db.prepare(`
    INSERT INTO domain_observations VALUES (?,?,?,?,?,?,?,?,?)
  `);
  insertObservation.run(
    CANONICAL_OBSERVATION, RACE_KEY, "settlement_result", "settlement_result",
    RAW_ID, PARSE_ID, null, null, null,
  );
  insertObservation.run(
    DUPLICATE_OBSERVATION, RACE_KEY, "settlement_result", "settlement_result",
    RAW_ID, PARSE_ID, null, null, null,
  );

  const semanticHash = candidateSemanticHash(4200);
  const insertCandidate = db.prepare(`
    INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  insertCandidate.run(
    "candidate-canonical", RACE_KEY, "trifecta", "settled", "normal", "initial",
    CANONICAL_OBSERVATION, PARSE_ID, RAW_ID, semanticHash, null, null,
  );
  insertCandidate.run(
    "candidate-duplicate", RACE_KEY, "trifecta", "settled", "normal", "initial",
    DUPLICATE_OBSERVATION, PARSE_ID, RAW_ID, semanticHash, null, null,
  );
  const insertPayout = db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?)");
  insertPayout.run("candidate-canonical", 1, "1-2-3", 4200, null, "payout");
  insertPayout.run("candidate-duplicate", 1, "1-2-3", 4200, null, "payout");

  const duplicateSemanticDigest = canonicalHash([["trifecta", semanticHash]]);
  db.prepare(`INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "resolution-1",
    DUPLICATE_OBSERVATION,
    CANONICAL_OBSERVATION,
    RACE_KEY,
    RAW_ID,
    "k260801.lzh",
    "source_duplicate",
    DETECTION_REASON,
    duplicateSemanticDigest,
    SOURCE_DUPLICATE_RESOLVER_VERSION,
    SOURCE_DUPLICATE_POLICY_VERSION,
    N1_CANONICAL_RESOLUTION_SCHEMA_VERSION,
  );
  return db;
}

test("source duplicate evidence revalidates candidate semantic hashes from persisted lines", () => {
  const db = createFixture();
  try {
    assert.deepEqual(
      [...readCurrentlyValidSourceDuplicateObservationIds(db)],
      [DUPLICATE_OBSERVATION],
    );

    db.prepare("UPDATE race_payout_lines_v2 SET payout_yen=4300 WHERE candidate_id=?")
      .run("candidate-duplicate");

    assert.throws(
      () => readCurrentlyValidSourceDuplicateObservationIds(db),
      /SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID:obs-duplicate/,
    );
  } finally {
    db.close();
  }
});
