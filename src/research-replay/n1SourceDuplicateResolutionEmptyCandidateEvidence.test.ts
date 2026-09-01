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
const DETECTION_REASON =
  "intra_file_source_duplicate: same raw document produced multiple identical race observations";

test("source duplicate evidence rejects matching observations with zero settlement candidates", () => {
  const db = new DatabaseSync(":memory:");
  try {
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
        observation_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        supersedes_candidate_id TEXT,
        correction_reason TEXT
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
    db.prepare("INSERT INTO raw_documents VALUES (?,?,?,?)").run(RAW_ID, "verified", "passed", 1);
    db.prepare("INSERT INTO parse_runs VALUES (?,?,?)").run(PARSE_ID, RAW_ID, "success");
    const insertObservation = db.prepare("INSERT INTO domain_observations VALUES (?,?,?,?,?,?,?,?,?)");
    insertObservation.run("obs-canonical", RACE_KEY, "settlement_result", "settlement_result", RAW_ID, PARSE_ID, null, null, null);
    insertObservation.run("obs-duplicate", RACE_KEY, "settlement_result", "settlement_result", RAW_ID, PARSE_ID, null, null, null);
    db.prepare("INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "resolution-1",
      "obs-duplicate",
      "obs-canonical",
      RACE_KEY,
      RAW_ID,
      "k260801.lzh",
      "source_duplicate",
      DETECTION_REASON,
      canonicalHash([]),
      SOURCE_DUPLICATE_RESOLVER_VERSION,
      SOURCE_DUPLICATE_POLICY_VERSION,
      N1_CANONICAL_RESOLUTION_SCHEMA_VERSION,
    );

    assert.throws(
      () => readCurrentlyValidSourceDuplicateObservationIds(db),
      /SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID:obs-duplicate/u,
    );
  } finally {
    db.close();
  }
});
