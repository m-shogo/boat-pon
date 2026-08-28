import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializeSidecarSchema } from "./schema";
import { initializeN1CanonicalResolutionSchema, initializeN1SettlementSchema } from "./settlement";
import { readN2EvaluationMetricsSettlements } from "./n2EvaluationMetricsSettlementReader";

const NOW = "2026-08-28T00:00:00.000Z";
const RACE_KEY = "2026-08-07:05:R1";

test("evaluation metrics reject producer-impossible active settlement semantic hash drift", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-eval-semantic-hash-"));
  const sidecarPath = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(sidecarPath);
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);

  db.prepare(`INSERT INTO raw_documents
    (raw_document_id, raw_sha256, entity_body_byte_length, content_type, charset, content_encoding,
     compressed_byte_length, decompression_ratio, integrity_status, storage_type, storage_path,
     first_recorded_at, retention_class, parser_replay_eligible, security_scan_status, created_at)
    VALUES ('raw-eval-semantic', ?, 100, 'text/plain','shift_jis',NULL,NULL,NULL,'verified',
      'content_addressed_filesystem','sha256/aa/bb/rawpath',?,'archive',1,'passed',?)`)
    .run("a".repeat(64), NOW, NOW);

  db.prepare(`INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
    VALUES ('parse-eval-semantic','raw-eval-semantic','n1-backfill-archive','n1-settlement-parser-v2','modern_seven_display',
      'rr-c14n-v1','settlement_result','success','[]',NULL,?,?,?,NULL,NULL,NULL,?)`)
    .run(NOW, NOW, "b".repeat(64), NOW);

  db.prepare(`INSERT INTO domain_observations
    (observation_id, canonical_race_key, observation_type, payload_type, payload_schema_version,
     parse_run_id, raw_document_id, source_published_at, source_observed_at, first_seen_at,
     timing_quality, source_quality, measurement_quality, semantic_payload_hash, supersedes_id,
     correction_kind, correction_reason, recorded_at, effective_at, created_at)
    VALUES ('obs-eval-semantic',?,'settlement_result','settlement_result','rr-payload-v1',
      'parse-eval-semantic','raw-eval-semantic',NULL,?,?,
      'observed_only','official_public','official_archive',?,NULL,NULL,NULL,?,?,?)`)
    .run(RACE_KEY, NOW, NOW, "c".repeat(64), NOW, NOW, NOW);

  db.prepare(`INSERT INTO settlement_candidates_v2
    (candidate_id, canonical_race_key, bet_type, settlement_status, result_kind,
     revision_kind, resolution_status, source_kind, source_schema_version,
     observation_id, parse_run_id, raw_document_id, semantic_hash,
     supersedes_candidate_id, correction_reason, observed_at, created_at)
    VALUES ('candidate-eval-semantic-invalid',?,'trifecta','settled','normal',
      'initial','resolved','official_archive','modern_seven_display',
      'obs-eval-semantic','parse-eval-semantic','raw-eval-semantic',?,NULL,NULL,?,?)`)
    .run(RACE_KEY, "d".repeat(64), NOW, NOW);

  db.prepare(`INSERT INTO race_payout_lines_v2
    (payout_line_id,candidate_id,line_no,bet_type,selection_raw,selection_normalized,
     selection_canonical,payout_yen,popularity,line_kind,created_at)
    VALUES ('payout-eval-semantic','candidate-eval-semantic-invalid',1,'trifecta',
      '1-2-3','1-2-3','1-2-3',1230,1,'payout',?)`)
    .run(NOW);
  db.close();

  try {
    const report = readN2EvaluationMetricsSettlements({ sidecarDbPath: sidecarPath, raceKeys: [RACE_KEY] });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes(
      `${RACE_KEY}:SETTLEMENT_SEMANTIC_HASH_MISMATCH:candidate-eval-semantic-invalid`,
    ));
    assert.equal(report.settlementCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
