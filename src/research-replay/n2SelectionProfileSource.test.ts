import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import {
  SOURCE_DUPLICATE_POLICY_VERSION,
  SOURCE_DUPLICATE_RESOLVER_VERSION,
  archiveFileForRaceKey,
} from "./n1CanonicalResolution";
import { readN2SelectionProfileSource } from "./n2SelectionProfileSource";
import { N1_CANONICAL_RESOLUTION_SCHEMA_VERSION } from "./settlement";

const DETECTION_REASON =
  "intra_file_source_duplicate: same raw document produced multiple identical race observations";

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE raw_documents (
      raw_document_id TEXT PRIMARY KEY,
      integrity_status TEXT NOT NULL,
      security_scan_status TEXT NOT NULL,
      parser_replay_eligible INTEGER NOT NULL
    );
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
      resolution_status TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      semantic_hash TEXT NOT NULL,
      supersedes_candidate_id TEXT,
      correction_reason TEXT
    );
    CREATE TABLE race_payout_lines_v2 (
      payout_line_id TEXT PRIMARY KEY,
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
      refund_line_id TEXT PRIMARY KEY,
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
    CREATE TABLE settlement_source_duplicate_resolutions_v2 (
      resolution_id TEXT PRIMARY KEY,
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
  return db;
}

function insertCandidate(
  db: DatabaseSync,
  input: {
    id: string;
    raceKey?: string;
    supersedes?: string | null;
    integrity?: string;
    security?: string;
    replayEligible?: number;
    payout?: number;
    rawDocumentId?: string;
    parseRunId?: string;
    semanticHash?: string;
  },
): void {
  const raceKey = input.raceKey ?? "2026-05-01:01:R1";
  const rawId = input.rawDocumentId ?? `raw-${input.id}`;
  const parseId = input.parseRunId ?? `parse-${input.id}`;
  const semanticHash = input.semanticHash ?? `semantic-${input.id}`;
  const observationId = `obs-${input.id}`;
  db.prepare("INSERT OR IGNORE INTO raw_documents VALUES (?,?,?,?)").run(
    rawId,
    input.integrity ?? "verified",
    input.security ?? "passed",
    input.replayEligible ?? 1,
  );
  db.prepare("INSERT OR IGNORE INTO parse_runs VALUES (?,?,?)").run(parseId, rawId, "success");
  db.prepare("INSERT INTO domain_observations VALUES (?,?,?,?,?,?,?,?,?)").run(
    observationId,
    raceKey,
    "settlement_result",
    "settlement_result",
    rawId,
    parseId,
    null,
    null,
    null,
  );
  db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    input.id,
    raceKey,
    "trifecta",
    "settled",
    "normal",
    "initial",
    "resolved",
    observationId,
    parseId,
    rawId,
    semanticHash,
    input.supersedes ?? null,
    null,
  );
  db.prepare("INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    `payout-${input.id}`,
    input.id,
    1,
    "trifecta",
    "1-2-3",
    "1-2-3",
    "1-2-3",
    input.payout ?? 1000,
    null,
    "payout",
  );
}

function insertSourceDuplicateResolution(
  db: DatabaseSync,
  input: {
    duplicateId: string;
    canonicalId: string;
    raceKey: string;
    rawDocumentId: string;
    semanticHash: string;
  },
): void {
  db.prepare("INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
    `resolution-${input.duplicateId}`,
    `obs-${input.duplicateId}`,
    `obs-${input.canonicalId}`,
    input.raceKey,
    input.rawDocumentId,
    archiveFileForRaceKey(input.raceKey),
    "source_duplicate",
    DETECTION_REASON,
    canonicalHash([["trifecta", input.semanticHash]]),
    SOURCE_DUPLICATE_RESOLVER_VERSION,
    SOURCE_DUPLICATE_POLICY_VERSION,
    N1_CANONICAL_RESOLUTION_SCHEMA_VERSION,
  );
}

test("selection profile excludes superseded settlement candidates", () => {
  const db = makeDb();
  try {
    insertCandidate(db, { id: "old", payout: 900 });
    insertCandidate(db, { id: "new", supersedes: "old", payout: 1200 });

    const profile = readN2SelectionProfileSource(db, "2026-05");

    assert.equal(profile.candidateCount, 1);
    assert.equal(profile.eligibleCandidateCount, 1);
    assert.equal(profile.byBetType.trifecta.candidates, 1);
    assert.equal(profile.byBetType.trifecta.positivePayoutYenPer100.max, 1200);
  } finally {
    db.close();
  }
});

test("selection profile rejects tainted raw lineage for an eligible label", () => {
  for (const raw of [
    { integrity: "quarantined", security: "passed", replayEligible: 1 },
    { integrity: "verified", security: "quarantined", replayEligible: 1 },
    { integrity: "verified", security: "passed", replayEligible: 0 },
  ]) {
    const db = makeDb();
    try {
      insertCandidate(db, { id: "active", ...raw });
      assert.throws(
        () => readN2SelectionProfileSource(db, "2026-05"),
        /N2_SELECTION_PROFILE_SETTLEMENT_LINEAGE_INVALID:active/u,
      );
    } finally {
      db.close();
    }
  }
});

test("selection profile rejects payout lines from another bet type", () => {
  const db = makeDb();
  try {
    insertCandidate(db, { id: "active" });
    db.prepare("UPDATE race_payout_lines_v2 SET bet_type='win' WHERE candidate_id='active'").run();
    assert.throws(
      () => readN2SelectionProfileSource(db, "2026-05"),
      /N2_SELECTION_PROFILE_PAYOUT_BET_LINEAGE_INVALID:active/u,
    );
  } finally {
    db.close();
  }
});

test("selection profile rejects refund lines from another bet type", () => {
  const db = makeDb();
  try {
    insertCandidate(db, { id: "active" });
    db.prepare("INSERT INTO race_refund_lines_v2 VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "refund-active",
      "active",
      1,
      "win",
      "1",
      "1",
      "1",
      "selection",
      100,
      "test",
    );
    assert.throws(
      () => readN2SelectionProfileSource(db, "2026-05"),
      /N2_SELECTION_PROFILE_REFUND_BET_LINEAGE_INVALID:active/u,
    );
  } finally {
    db.close();
  }
});

test("selection profile excludes only currently valid source duplicates", () => {
  const db = makeDb();
  try {
    const raceKey = "2026-05-01:01:R1";
    const rawDocumentId = "raw-shared";
    const parseRunId = "parse-shared";
    const semanticHash = "semantic-shared";
    insertCandidate(db, { id: "canonical", raceKey, rawDocumentId, parseRunId, semanticHash });
    insertCandidate(db, { id: "duplicate", raceKey, rawDocumentId, parseRunId, semanticHash });
    insertSourceDuplicateResolution(db, {
      duplicateId: "duplicate",
      canonicalId: "canonical",
      raceKey,
      rawDocumentId,
      semanticHash,
    });

    const profile = readN2SelectionProfileSource(db, "2026-05");
    assert.equal(profile.candidateCount, 2);
    assert.equal(profile.eligibleCandidateCount, 1);
  } finally {
    db.close();
  }
});

test("selection profile fails closed on stale source-duplicate evidence", () => {
  const db = makeDb();
  try {
    const raceKey = "2026-05-01:01:R1";
    insertCandidate(db, { id: "active", raceKey });
    db.prepare("INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "stale",
      "obs-active",
      "missing-observation",
      raceKey,
      "raw-active",
      archiveFileForRaceKey(raceKey),
      "source_duplicate",
      DETECTION_REASON,
      "deadbeef",
      SOURCE_DUPLICATE_RESOLVER_VERSION,
      SOURCE_DUPLICATE_POLICY_VERSION,
      N1_CANONICAL_RESOLUTION_SCHEMA_VERSION,
    );
    assert.throws(
      () => readN2SelectionProfileSource(db, "2026-05"),
      /SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID:obs-active/u,
    );
  } finally {
    db.close();
  }
});
