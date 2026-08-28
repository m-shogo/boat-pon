import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import {
  initializeN1CanonicalResolutionSchema,
  initializeN1SettlementSchema,
  SettlementRepository,
} from "./settlement";
import { loadActiveState } from "./n2SettlementReparseEngine";

const NOW = "2026-08-28T00:00:00.000Z";
const RACE_KEY = "2020-05-01:12:R1";

function setup(integrityStatus: "verified" | "quarantined") {
  const root = mkdtempSync(join(tmpdir(), "reparse-active-lineage-test-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  db.exec("PRAGMA synchronous=OFF;");
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);

  db.prepare(`INSERT INTO raw_documents
    (raw_document_id, raw_sha256, entity_body_byte_length, content_type, charset, content_encoding,
     compressed_byte_length, decompression_ratio, integrity_status, storage_type, storage_path,
     first_recorded_at, retention_class, parser_replay_eligible, security_scan_status, created_at)
    VALUES ('raw-incumbent', ?, 100, 'text/plain','shift_jis',NULL,NULL,NULL,?,
      'content_addressed_filesystem','sha256/aa/bb/rawpath',?,'archive',1,'passed',?)`)
    .run("a".repeat(64), integrityStatus, NOW, NOW);

  db.prepare(`INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
    VALUES ('parse-incumbent','raw-incumbent','n1-backfill-archive','n1-settlement-parser-v1','modern_seven_display',
      'rr-c14n-v1','settlement_result','success','[]',NULL,?,?,?,NULL,NULL,NULL,?)`)
    .run(NOW, NOW, "b".repeat(64), NOW);

  db.prepare(`INSERT INTO domain_observations
    (observation_id, canonical_race_key, observation_type, payload_type, payload_schema_version,
     parse_run_id, raw_document_id, source_published_at, source_observed_at, first_seen_at,
     timing_quality, source_quality, measurement_quality, semantic_payload_hash, supersedes_id,
     correction_kind, correction_reason, recorded_at, effective_at, created_at)
    VALUES ('obs-incumbent',?,'settlement_result','settlement_result','rr-payload-v1',
      'parse-incumbent','raw-incumbent',NULL,?,?,
      'observed_only','historical_archive','official_archive',?,NULL,NULL,NULL,?,?,?)`)
    .run(RACE_KEY, NOW, NOW, "c".repeat(64), NOW, NOW, NOW);

  const repo = new SettlementRepository(db, () => "candidate-incumbent");
  repo.appendCandidate({
    canonicalRaceKey: RACE_KEY,
    betType: "win",
    settlementStatus: "settled",
    resultKind: "special_payout",
    revisionKind: "initial",
    resolutionStatus: "resolved",
    sourceKind: "official_archive",
    sourceSchemaVersion: "modern_seven_display",
    observationId: "obs-incumbent",
    parseRunId: "parse-incumbent",
    rawDocumentId: "raw-incumbent",
    observedAt: NOW,
    supersedesCandidateId: null,
    correctionReason: null,
    payouts: [{ selection: "特", payoutYen: 70, popularity: null, lineKind: "special_payout" }],
    refunds: [],
    emitEvidencePins: false,
  });
  return db;
}

test("settlement reparse accepts a fully eligible active incumbent", () => {
  const db = setup("verified");
  const active = loadActiveState(db, new Set());
  assert.equal(active.active.size, 1);
  assert.equal(active.active.get(`${RACE_KEY}:win`)?.candidateId, "candidate-incumbent");
  db.close();
});

test("settlement reparse fails closed when an active incumbent raw is quarantined", () => {
  const db = setup("quarantined");
  assert.throws(
    () => loadActiveState(db, new Set()),
    /REPARSE_ACTIVE_LINEAGE_INVALID:candidate-incumbent/,
  );
  db.close();
});
