import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializeSidecarSchema } from "./schema";
import { initializeN1CanonicalResolutionSchema, initializeN1SettlementSchema } from "./settlement";
import { loadActiveState } from "./n2SettlementReparseEngine";

const NOW = "2026-08-28T00:00:00.000Z";
const RACE_KEY = "2024-06-05:12:R1";

test("reparse active state rejects producer-impossible incumbent semantic hash drift", () => {
  const db = new DatabaseSync(":memory:");
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);

  db.prepare(`INSERT INTO raw_documents
    (raw_document_id, raw_sha256, entity_body_byte_length, content_type, charset, content_encoding,
     compressed_byte_length, decompression_ratio, integrity_status, storage_type, storage_path,
     first_recorded_at, retention_class, parser_replay_eligible, security_scan_status, created_at)
    VALUES ('raw-reparse-semantic', ?, 100, 'text/plain','shift_jis',NULL,NULL,NULL,'verified',
      'content_addressed_filesystem','sha256/aa/bb/rawpath',?,'archive',1,'passed',?)`)
    .run("a".repeat(64), NOW, NOW);

  db.prepare(`INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
    VALUES ('parse-reparse-semantic','raw-reparse-semantic','n1-backfill-archive','n1-settlement-parser-v1','modern_seven_display',
      'rr-c14n-v1','settlement_result','success','[]',NULL,?,?,?,NULL,NULL,NULL,?)`)
    .run(NOW, NOW, "b".repeat(64), NOW);

  db.prepare(`INSERT INTO domain_observations
    (observation_id, canonical_race_key, observation_type, payload_type, payload_schema_version,
     parse_run_id, raw_document_id, source_published_at, source_observed_at, first_seen_at,
     timing_quality, source_quality, measurement_quality, semantic_payload_hash, supersedes_id,
     correction_kind, correction_reason, recorded_at, effective_at, created_at)
    VALUES ('obs-reparse-semantic',?,'settlement_result','settlement_result','rr-payload-v1',
      'parse-reparse-semantic','raw-reparse-semantic',NULL,?,?,
      'observed_only','official_public','official_archive',?,NULL,NULL,NULL,?,?,?)`)
    .run(RACE_KEY, NOW, NOW, "c".repeat(64), NOW, NOW, NOW);

  db.prepare(`INSERT INTO settlement_candidates_v2
    (candidate_id, canonical_race_key, bet_type, settlement_status, result_kind,
     revision_kind, resolution_status, source_kind, source_schema_version,
     observation_id, parse_run_id, raw_document_id, semantic_hash,
     supersedes_candidate_id, correction_reason, observed_at, created_at)
    VALUES ('candidate-reparse-semantic-invalid',?,'win','settled','normal',
      'initial','resolved','official_archive','modern_seven_display',
      'obs-reparse-semantic','parse-reparse-semantic','raw-reparse-semantic',?,NULL,NULL,?,?)`)
    .run(RACE_KEY, "d".repeat(64), NOW, NOW);

  assert.throws(
    () => loadActiveState(db, new Set()),
    /REPARSE_ACTIVE_LINEAGE_INVALID:candidate-reparse-semantic-invalid/,
  );

  db.close();
});
