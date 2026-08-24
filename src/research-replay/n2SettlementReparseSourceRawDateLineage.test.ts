import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { assertN2SettlementReparseSourceRawDateLineage } from "./n2SettlementReparseSourceRawDateLineage";

const NOW = "2026-08-24T00:00:00.000Z";
const RAW_ID = "raw-reparse-date-lineage";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "reparse-source-date-lineage-test-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  db.exec("PRAGMA synchronous=OFF;");
  initializeSidecarSchema(db, NOW);
  db.prepare(`INSERT INTO raw_documents
    (raw_document_id, raw_sha256, entity_body_byte_length, content_type, charset, content_encoding,
     compressed_byte_length, decompression_ratio, integrity_status, storage_type, storage_path,
     first_recorded_at, retention_class, parser_replay_eligible, security_scan_status, created_at)
    VALUES (?,?,?, 'text/plain','shift_jis',NULL,NULL,NULL,'verified','content_addressed_filesystem',?, ?, 'archive',1,'passed',?)`)
    .run(RAW_ID, "e".repeat(64), 100, "sha256/ee/ff/rawpath", NOW, NOW);
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
    VALUES ('source-parse',?,'n1-backfill-archive','n1-settlement-parser-v1','modern_seven_display',
      'rr-c14n-v1','settlement_result','success','[]',NULL,?,?,?,NULL,NULL,NULL,?)`)
    .run(RAW_ID, NOW, NOW, "f".repeat(64), NOW);
  return db;
}

function insertObservation(db: ReturnType<typeof setup>, id: string, raceKey: string): void {
  db.prepare(`INSERT INTO domain_observations
    (observation_id, canonical_race_key, observation_type, payload_type, payload_schema_version,
     parse_run_id, raw_document_id, source_published_at, source_observed_at, first_seen_at,
     timing_quality, source_quality, measurement_quality, semantic_payload_hash, supersedes_id,
     correction_kind, correction_reason, recorded_at, effective_at, created_at)
    VALUES (?,?,'settlement_result','settlement_result','rr-payload-v1','source-parse',?,NULL,?,?,
      'observed_only','derived_existing_row','official_archive',?,NULL,NULL,NULL,?,?,?)`)
    .run(id, raceKey, RAW_ID, NOW, NOW, "a".repeat(64), NOW, NOW, NOW);
}

test("reparse source raw date lineage accepts one canonical race date", () => {
  const db = setup();
  insertObservation(db, "obs-1", "2020-05-01:12:R1");
  insertObservation(db, "obs-2", "2020-05-01:12:R12");
  assert.doesNotThrow(() => assertN2SettlementReparseSourceRawDateLineage(db, RAW_ID, "2020-05-01"));
  db.close();
});

test("reparse source raw date lineage rejects impossible canonical race identity", () => {
  const db = setup();
  insertObservation(db, "obs-1", "2020-05-32:12:R1");
  assert.throws(
    () => assertN2SettlementReparseSourceRawDateLineage(db, RAW_ID, "2020-05-01"),
    /REPARSE_SOURCE_RAW_RACE_IDENTITY_INVALID:raw-reparse-date-lineage:2020-05-32:12:R1/,
  );
  db.close();
});

test("reparse source raw date lineage rejects multiple race dates for one raw document", () => {
  const db = setup();
  insertObservation(db, "obs-1", "2020-05-01:12:R1");
  insertObservation(db, "obs-2", "2020-05-02:12:R1");
  assert.throws(
    () => assertN2SettlementReparseSourceRawDateLineage(db, RAW_ID, "2020-05-01"),
    /REPARSE_SOURCE_RAW_DATE_AMBIGUOUS:raw-reparse-date-lineage:2020-05-01:2020-05-02/,
  );
  db.close();
});

test("reparse source raw date lineage rejects a metadata date that disagrees with source observations", () => {
  const db = setup();
  insertObservation(db, "obs-1", "2020-05-02:12:R1");
  assert.throws(
    () => assertN2SettlementReparseSourceRawDateLineage(db, RAW_ID, "2020-05-01"),
    /REPARSE_SOURCE_RAW_DATE_MISMATCH:raw-reparse-date-lineage:2020-05-01:2020-05-02/,
  );
  db.close();
});
