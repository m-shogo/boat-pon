import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializeSidecarSchema } from "../research-replay/schema";
import {
  initializeN1CanonicalResolutionSchema,
  initializeN1SettlementSchema,
} from "../research-replay/settlement";
import { runN2ActiveFeatureCoverageAudit } from "./n2FeatureCoverageAuditRuntime";

const NOW = "2026-08-28T00:00:00.000Z";
const RACE_KEY = "2024-06-05:12:R1";

test("feature coverage direct runtime rejects invalid active settlement semantic hash", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-coverage-preflight-"));
  const sidecarPath = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(sidecarPath);
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);

  db.prepare(`INSERT INTO raw_documents
    (raw_document_id, raw_sha256, entity_body_byte_length, content_type, charset, content_encoding,
     compressed_byte_length, decompression_ratio, integrity_status, storage_type, storage_path,
     first_recorded_at, retention_class, parser_replay_eligible, security_scan_status, created_at)
    VALUES ('raw-feature-preflight', ?, 100, 'text/plain','shift_jis',NULL,NULL,NULL,'verified',
      'content_addressed_filesystem','sha256/aa/bb/rawpath',?,'archive',1,'passed',?)`)
    .run("a".repeat(64), NOW, NOW);

  db.prepare(`INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
    VALUES ('parse-feature-preflight','raw-feature-preflight','n1-backfill-archive','n1-settlement-parser-v1','modern_seven_display',
      'rr-c14n-v1','settlement_result','success','[]',NULL,?,?,?,NULL,NULL,NULL,?)`)
    .run(NOW, NOW, "b".repeat(64), NOW);

  db.prepare(`INSERT INTO domain_observations
    (observation_id, canonical_race_key, observation_type, payload_type, payload_schema_version,
     parse_run_id, raw_document_id, source_published_at, source_observed_at, first_seen_at,
     timing_quality, source_quality, measurement_quality, semantic_payload_hash, supersedes_id,
     correction_kind, correction_reason, recorded_at, effective_at, created_at)
    VALUES ('obs-feature-preflight',?,'settlement_result','settlement_result','rr-payload-v1',
      'parse-feature-preflight','raw-feature-preflight',NULL,?,?,
      'observed_only','official_public','official_archive',?,NULL,NULL,NULL,?,?,?)`)
    .run(RACE_KEY, NOW, NOW, "c".repeat(64), NOW, NOW, NOW);

  db.prepare(`INSERT INTO settlement_candidates_v2
    (candidate_id, canonical_race_key, bet_type, settlement_status, result_kind,
     revision_kind, resolution_status, source_kind, source_schema_version,
     observation_id, parse_run_id, raw_document_id, semantic_hash,
     supersedes_candidate_id, correction_reason, observed_at, created_at)
    VALUES ('candidate-feature-preflight-invalid',?,'win','settled','normal',
      'initial','resolved','official_archive','modern_seven_display',
      'obs-feature-preflight','parse-feature-preflight','raw-feature-preflight',?,NULL,NULL,?,?)`)
    .run(RACE_KEY, "d".repeat(64), NOW, NOW);
  db.close();

  try {
    const result = runN2ActiveFeatureCoverageAudit({
      repoRoot: root,
      runId: "test-run",
      requestId: "test-request",
      taskId: "TASK-N2-006",
      sidecarPath,
      historyDir: join(root, "history"),
      reportsDir: join(root, "reports"),
      dryRun: true,
      taskStatuses: { "TASK-N2-004": "PASS" },
    });
    assert.equal(result.result, "BLOCKED");
    assert.deepEqual(result.blocks, [
      "DATASET_ACTIVE_SETTLEMENT_LINEAGE_INVALID:candidate-feature-preflight-invalid",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
