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
const RAW_ID = "raw-target-lineage";
const SOURCE_PARSE_ID = "v1-parse-target-lineage";
const TARGET_PARSE_ID = `rpr-parse-${RAW_ID}`;
const META: RawMeta = { rawDocumentId: RAW_ID, date: "2020-05-01", family: "modern_seven_display" };
const DERIVED: DerivedCandidate[] = [{
  raceKey: "2020-05-01:12:R1",
  betType: "win",
  status: "settled",
  resultKind: "special_payout",
  payouts: [{ selection: "特", payoutYen: 70, popularity: null, lineKind: "special_payout" }],
  refunds: [],
}];

type TargetOverrides = Partial<{
  parserName: string;
  semanticPayloadHash: string;
}>;

function setup(): { db: DatabaseSync; repo: SettlementRepository } {
  const root = mkdtempSync(join(tmpdir(), "reparse-target-lineage-test-"));
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
    .run(RAW_ID, "c".repeat(64), 100, "sha256/cc/dd/rawpath", NOW, NOW);
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
    VALUES (?,?, 'n1-backfill-archive','n1-settlement-parser-v1','modern_seven_display','rr-c14n-v1',
            'settlement_result','success','[]',NULL,?,?,?,NULL,NULL,NULL,?)`)
    .run(SOURCE_PARSE_ID, RAW_ID, NOW, NOW, "d".repeat(64), NOW);
  return { db, repo: new SettlementRepository(db, () => "id-target-lineage") };
}

function insertTargetParseRun(db: DatabaseSync, overrides: TargetOverrides = {}): void {
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
    VALUES (?,?,?,?,?,?, 'settlement_result','success','[]',NULL,?,?,?,?, 'parser_reparse', ?, ?)`)
    .run(
      TARGET_PARSE_ID,
      RAW_ID,
      overrides.parserName ?? REPARSE_PARSER_NAME,
      REPARSE_TARGET_PARSER_VERSION,
      META.family,
      REPARSE_CANONICALIZATION_VERSION,
      NOW,
      NOW,
      overrides.semanticPayloadHash ?? canonicalHash({ reparse: RAW_ID }),
      SOURCE_PARSE_ID,
      REPARSE_DEFECT_CODE,
      NOW,
    );
}

function assertNoNewReparseSideEffects(db: DatabaseSync, state: ReturnType<typeof newState>): void {
  const observationCount = Number((db.prepare("SELECT COUNT(*) AS n FROM domain_observations").get() as { n: number }).n);
  const candidateCount = Number((db.prepare("SELECT COUNT(*) AS n FROM settlement_candidates_v2").get() as { n: number }).n);
  assert.equal(observationCount, 0);
  assert.equal(candidateCount, 0);
  assert.equal(state.counts.appended_parse_runs, 0);
  assert.equal(state.counts.appended_observations, 0);
  assert.equal(state.counts.appended_candidates, 0);
}

for (const conflict of [
  { label: "wrong parser name", overrides: { parserName: "other-reparse" } },
  { label: "stale semantic payload hash", overrides: { semanticPayloadHash: "e".repeat(64) } },
] satisfies Array<{ label: string; overrides: TargetOverrides }>) {
  test(`reparse rejects pre-existing target parse run with ${conflict.label}`, () => {
    const { db, repo } = setup();
    insertTargetParseRun(db, conflict.overrides);
    const state = newState();

    assert.throws(
      () => applyReparseForDocument(
        db,
        repo,
        META,
        DERIVED,
        loadActiveState(db, loadSourceDuplicateSet(db)),
        state,
        NOW,
      ),
      /REPARSE_TARGET_PARSE_RUN_CONFLICT:raw-target-lineage:rpr-parse-raw-target-lineage/,
    );
    assertNoNewReparseSideEffects(db, state);
    db.close();
  });
}

test("reparse accepts an exact pre-existing target parse run for idempotent continuation", () => {
  const { db, repo } = setup();
  insertTargetParseRun(db);
  const state = newState();

  applyReparseForDocument(
    db,
    repo,
    META,
    DERIVED,
    loadActiveState(db, loadSourceDuplicateSet(db)),
    state,
    NOW,
  );

  assert.equal(state.counts.appended_parse_runs, 0);
  assert.equal(state.counts.appended_observations, 1);
  assert.equal(state.counts.appended_candidates, 1);
  db.close();
});
