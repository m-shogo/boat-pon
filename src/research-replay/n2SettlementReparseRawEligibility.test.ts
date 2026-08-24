import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";

import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import {
  initializeN1CanonicalResolutionSchema,
  initializeN1SettlementSchema,
  SettlementRepository,
} from "./settlement";
import type { DerivedCandidate } from "./n2SettlementReparse";
import {
  applyReparseForDocument,
  loadActiveState,
  loadSourceDuplicateSet,
  newState,
  type RawMeta,
} from "./n2SettlementReparseEngine";

const NOW = "2026-08-24T00:00:00.000Z";
const RAW_ID = "raw-reparse-eligibility";
const META: RawMeta = {
  rawDocumentId: RAW_ID,
  date: "2020-05-01",
  family: "modern_seven_display",
};
const DERIVED: DerivedCandidate[] = [{
  raceKey: "2020-05-01:12:R1",
  betType: "win",
  status: "settled",
  resultKind: "special_payout",
  payouts: [{ selection: "特", payoutYen: 70, popularity: null, lineKind: "special_payout" }],
  refunds: [],
}];

type RawEligibility = {
  integrityStatus: "verified" | "quarantined";
  securityScanStatus: "passed" | "quarantined";
  parserReplayEligible: 0 | 1;
};

function setup(raw: RawEligibility): { db: DatabaseSync; repo: SettlementRepository } {
  const root = mkdtempSync(join(tmpdir(), "reparse-raw-eligibility-test-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  db.exec("PRAGMA synchronous=OFF;");
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);
  db.prepare(`INSERT INTO raw_documents
    (raw_document_id, raw_sha256, entity_body_byte_length, content_type, charset, content_encoding,
     compressed_byte_length, decompression_ratio, integrity_status, storage_type, storage_path,
     first_recorded_at, retention_class, parser_replay_eligible, security_scan_status, created_at)
    VALUES (?,?,?, 'text/plain','shift_jis',NULL,NULL,NULL,?,'content_addressed_filesystem',?, ?, 'archive',?,?,?)`)
    .run(
      RAW_ID,
      "e".repeat(64),
      100,
      raw.integrityStatus,
      "sha256/ee/ff/rawpath",
      NOW,
      raw.parserReplayEligible,
      raw.securityScanStatus,
      NOW,
    );
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
    VALUES ('source-parse',?,'n1-backfill-archive','n1-settlement-parser-v1','modern_seven_display',
      'rr-c14n-v1','settlement_result','success','[]',NULL,?,?,?,NULL,NULL,NULL,?)`)
    .run(RAW_ID, NOW, NOW, "f".repeat(64), NOW);
  return { db, repo: new SettlementRepository(db, () => "id-reparse-eligibility") };
}

function assertNoReparseWrites(db: DatabaseSync): void {
  const parseRuns = Number((db.prepare(
    "SELECT COUNT(*) AS n FROM parse_runs WHERE parser_name='n2-settlement-reparse'",
  ).get() as { n: number }).n);
  const observations = Number((db.prepare("SELECT COUNT(*) AS n FROM domain_observations").get() as { n: number }).n);
  const candidates = Number((db.prepare("SELECT COUNT(*) AS n FROM settlement_candidates_v2").get() as { n: number }).n);
  assert.equal(parseRuns, 0);
  assert.equal(observations, 0);
  assert.equal(candidates, 0);
}

for (const raw of [
  { label: "quarantined integrity", integrityStatus: "quarantined", securityScanStatus: "passed", parserReplayEligible: 1 },
  { label: "quarantined security scan", integrityStatus: "verified", securityScanStatus: "quarantined", parserReplayEligible: 1 },
  { label: "disabled parser replay", integrityStatus: "verified", securityScanStatus: "passed", parserReplayEligible: 0 },
] as const) {
  test(`settlement reparse rejects ${raw.label} before append`, () => {
    const { db, repo } = setup(raw);
    const active = loadActiveState(db, loadSourceDuplicateSet(db));
    const state = newState();

    assert.throws(
      () => applyReparseForDocument(db, repo, META, DERIVED, active, state, NOW),
      /REPARSE_SOURCE_RAW_INELIGIBLE:raw-reparse-eligibility/,
    );
    assertNoReparseWrites(db);
    assert.equal(state.counts.appended_parse_runs, 0);
    assert.equal(state.counts.appended_observations, 0);
    assert.equal(state.counts.appended_candidates, 0);
    db.close();
  });
}
