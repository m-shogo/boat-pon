import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "./canonical";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { initializeN1CanonicalResolutionSchema, initializeN1SettlementSchema, SettlementRepository } from "./settlement";
import {
  REPARSE_CANONICALIZATION_VERSION,
  REPARSE_PARSER_NAME,
  REPARSE_TARGET_PARSER_VERSION,
  type DerivedCandidate,
} from "./n2SettlementReparse";
import {
  REPARSE_DEFECT_CODE,
  applyReparseForDocument,
  loadActiveState,
  loadSourceDuplicateSet,
  newState,
  type RawMeta,
} from "./n2SettlementReparseEngine";

const NOW = "2026-08-01T00:00:00.000Z";
const RAW_ID = "raw-candidate-lineage";
const SOURCE_PARSE_ID = "v1-parse-candidate-lineage";
const TARGET_PARSE_ID = `rpr-parse-${RAW_ID}`;
const RACE_KEY = "2020-05-01:12:R1";
const OBSERVATION_ID = `rpr-obs-${RAW_ID}-${RACE_KEY}`;
const META: RawMeta = { rawDocumentId: RAW_ID, date: "2020-05-01", family: "modern_seven_display" };
const DERIVED: DerivedCandidate[] = [{
  raceKey: RACE_KEY,
  betType: "win",
  status: "settled",
  resultKind: "special_payout",
  payouts: [{ selection: "特", payoutYen: 70, popularity: null, lineKind: "special_payout" }],
  refunds: [],
}];

function setup(): { db: DatabaseSync; repo: SettlementRepository } {
  const root = mkdtempSync(join(tmpdir(), "reparse-candidate-lineage-test-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  db.exec("PRAGMA synchronous=OFF;");
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);
  db.prepare(`INSERT INTO raw_documents
    (raw_document_id, raw_sha256, entity_body_byte_length, content_type, charset, content_encoding,
     compressed_byte_length, decompression_ratio, integrity_status, storage_type, storage_path,
     first_recorded_at, retention_class, parser_replay_eligible, security_scan_status, created_at)
    VALUES (?,?,?, 'text/plain','shift_jis',NULL,NULL,NULL,'verified','content_addressed_filesystem',?, ?, 'archive',1,'passed',?)`)
    .run(RAW_ID, "f".repeat(64), 100, "sha256/ff/00/rawpath", NOW, NOW);
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
    VALUES (?,?, 'n1-backfill-archive','n1-settlement-parser-v1','modern_seven_display','rr-c14n-v1',
            'settlement_result','success','[]',NULL,?,?,?,NULL,NULL,NULL,?)`)
    .run(SOURCE_PARSE_ID, RAW_ID, NOW, NOW, "a".repeat(64), NOW);
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
    VALUES (?,?,?,?,?,?, 'settlement_result','success','[]',NULL,?,?,?,?, 'parser_reparse', ?, ?)`)
    .run(
      TARGET_PARSE_ID,
      RAW_ID,
      REPARSE_PARSER_NAME,
      REPARSE_TARGET_PARSER_VERSION,
      META.family,
      REPARSE_CANONICALIZATION_VERSION,
      NOW,
      NOW,
      canonicalHash({ reparse: RAW_ID }),
      SOURCE_PARSE_ID,
      REPARSE_DEFECT_CODE,
      NOW,
    );
  db.prepare(`INSERT INTO domain_observations
    (observation_id, canonical_race_key, observation_type, payload_type, payload_schema_version,
     parse_run_id, raw_document_id, source_published_at, source_observed_at, first_seen_at,
     timing_quality, source_quality, measurement_quality, semantic_payload_hash, supersedes_id,
     correction_kind, correction_reason, recorded_at, effective_at, created_at)
    VALUES (?,?, 'settlement_result','settlement_result','rr-payload-v1', ?,?, NULL, ?, ?,
            'observed_only','derived_existing_row','official_archive', ?, NULL, 'parser_reparse', ?, ?, ?, ?)`)
    .run(
      OBSERVATION_ID,
      RACE_KEY,
      TARGET_PARSE_ID,
      RAW_ID,
      NOW,
      NOW,
      canonicalHash({ reparse: OBSERVATION_ID }),
      REPARSE_DEFECT_CODE,
      NOW,
      NOW,
      NOW,
    );
  let id = 0;
  return { db, repo: new SettlementRepository(db, () => `candidate-lineage-${++id}`) };
}

function insertCandidate(repo: SettlementRepository, parseRunId: string): void {
  repo.appendCandidate({
    canonicalRaceKey: RACE_KEY,
    betType: "win",
    settlementStatus: "settled",
    resultKind: "special_payout",
    revisionKind: "initial",
    resolutionStatus: "resolved",
    sourceKind: "official_archive",
    sourceSchemaVersion: META.family,
    observationId: OBSERVATION_ID,
    parseRunId,
    rawDocumentId: RAW_ID,
    observedAt: NOW,
    payouts: DERIVED[0].payouts.map((p) => ({
      selection: p.selection,
      payoutYen: p.payoutYen,
      popularity: p.popularity,
      lineKind: p.lineKind,
    })),
    refunds: [],
    emitEvidencePins: false,
  });
}

function candidateCount(db: DatabaseSync): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM settlement_candidates_v2").get() as { n: number }).n);
}

test("reparse rejects semantic candidate reuse with stale parse lineage", () => {
  const { db, repo } = setup();
  const activeState = loadActiveState(db, loadSourceDuplicateSet(db));
  insertCandidate(repo, SOURCE_PARSE_ID);
  const state = newState();

  assert.throws(
    () => applyReparseForDocument(db, repo, META, DERIVED, activeState, state, NOW),
    /SETTLEMENT_CANDIDATE_REUSE_CONFLICT:candidate-lineage-1/,
  );
  assert.equal(candidateCount(db), 1);
  assert.equal(state.counts.appended_parse_runs, 0);
  assert.equal(state.counts.appended_observations, 0);
  assert.equal(state.counts.appended_candidates, 0);
  db.close();
});

test("reparse accepts exact candidate lineage for idempotent continuation", () => {
  const { db, repo } = setup();
  const activeState = loadActiveState(db, loadSourceDuplicateSet(db));
  insertCandidate(repo, TARGET_PARSE_ID);
  const state = newState();

  applyReparseForDocument(db, repo, META, DERIVED, activeState, state, NOW);

  assert.equal(candidateCount(db), 1);
  assert.equal(state.counts.appended_parse_runs, 0);
  assert.equal(state.counts.appended_observations, 0);
  assert.equal(state.counts.appended_candidates, 0);
  db.close();
});
