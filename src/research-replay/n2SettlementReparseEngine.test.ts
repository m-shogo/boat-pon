import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { initializeN1SettlementSchema, initializeN1CanonicalResolutionSchema, SettlementRepository } from "./settlement";
import type { DerivedCandidate } from "./n2SettlementReparse";
import {
  activeStatusCounts, appendOnlyEnforcement, applyReparseForDocument, computeAfter, lightIntegrity, loadActiveState,
  loadSourceDuplicateSet, newState, physicalRowCount, type RawMeta,
} from "./n2SettlementReparseEngine";

const NOW = "2026-08-01T00:00:00.000Z";
const RAW_ID = "raw-doc-1";
const V1_PARSE = "v1-parse-1";

function setup(): { db: DatabaseSync; repo: SettlementRepository } {
  const root = mkdtempSync(join(tmpdir(), "reparse-engine-test-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  db.exec("PRAGMA synchronous=OFF;");
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);
  // synthetic raw_document + v1 parse_run（provenance）。
  db.prepare(`INSERT INTO raw_documents
    (raw_document_id, raw_sha256, entity_body_byte_length, content_type, charset, content_encoding,
     compressed_byte_length, decompression_ratio, integrity_status, storage_type, storage_path,
     first_recorded_at, retention_class, parser_replay_eligible, security_scan_status, created_at)
    VALUES (?,?,?, 'text/plain','shift_jis',NULL,NULL,NULL,'verified','content_addressed_filesystem',?, ?, 'archive',1,'passed',?)`)
    .run(RAW_ID, "a".repeat(64), 100, "sha256/aa/bb/rawpath", NOW, NOW);
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
    VALUES (?,?, 'n1-backfill-archive','n1-settlement-parser-v1','modern_seven_display','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,?,NULL,NULL,NULL,?)`)
    .run(V1_PARSE, RAW_ID, NOW, NOW, "h".repeat(64), NOW);
  return { db, repo: new SettlementRepository(db, seqId()) };
}

function seqId(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

function insertObs(db: DatabaseSync, obsId: string, raceKey: string): void {
  db.prepare(`INSERT OR IGNORE INTO domain_observations
    (observation_id, canonical_race_key, observation_type, payload_type, payload_schema_version,
     parse_run_id, raw_document_id, source_published_at, source_observed_at, first_seen_at,
     timing_quality, source_quality, measurement_quality, semantic_payload_hash, supersedes_id,
     correction_kind, correction_reason, recorded_at, effective_at, created_at)
    VALUES (?,?, 'settlement_result','settlement_result','rr-payload-v1', ?,?, NULL, ?, ?,
            'observed_only','official_public','official_archive', ?, NULL, NULL, NULL, ?, ?, ?)`)
    .run(obsId, raceKey, V1_PARSE, RAW_ID, NOW, NOW, "p".repeat(64), NOW, NOW, NOW);
}

// v1 candidate を1件 append する。
function insertV1(db: DatabaseSync, repo: SettlementRepository, raceKey: string, betType: string, status: string, payouts: any[], refunds: any[]): void {
  const obsId = `obs-${raceKey}-${betType}`;
  insertObs(db, obsId, raceKey);
  repo.appendCandidate({
    canonicalRaceKey: raceKey, betType: betType as any, settlementStatus: status as any, resultKind: "normal",
    revisionKind: "initial", resolutionStatus: "resolved", sourceKind: "official_archive",
    sourceSchemaVersion: "modern_seven_display", observationId: obsId, parseRunId: V1_PARSE, rawDocumentId: RAW_ID,
    observedAt: NOW, payouts, refunds, emitEvidencePins: false,
  });
}

const meta: RawMeta = { rawDocumentId: RAW_ID, date: "2020-05-01", family: "modern_seven_display" };
const RK = "2020-05-01:12:R1";

function v2(raceKey: string, betType: string, status: string, resultKind: string, payouts: any[], refunds: any[]): DerivedCandidate {
  return { raceKey, betType: betType as any, status: status as any, resultKind: resultKind as any, payouts, refunds };
}
const settledPayout = [{ selection: "1-2", payoutYen: 800, popularity: 1, lineKind: "payout" as const }];
const refundLine = [{ selection: null, scope: "bet_type" as const, refundYenPer100: 100, reasonCode: "ARCHIVE_RETURNED" }];
const specialPayout = [{ selection: "特", payoutYen: 70, popularity: null, lineKind: "special_payout" as const }];

test("false refund correction supersedes v1 refunded and active resolver returns settled", () => {
  const { db, repo } = setup();
  insertV1(db, repo, RK, "exacta", "refunded", [], refundLine); // v1 false refund
  insertV1(db, repo, RK, "trifecta", "settled", [{ selection: "1-2-3", payoutYen: 4200, popularity: 1, lineKind: "payout" }], []); // exact
  insertV1(db, repo, RK, "quinella", "refunded", [], refundLine); // genuine refund (v2 also refunded)

  const active = loadActiveState(db, loadSourceDuplicateSet(db));
  assert.equal(active.active.size, 3);
  assert.equal(active.before.refunded, 2);
  assert.equal(active.before.settled, 1);

  const state = newState();
  const derived = [
    v2(RK, "exacta", "settled", "normal", settledPayout, []),       // false refund -> settled
    v2(RK, "trifecta", "settled", "normal", [{ selection: "1-2-3", payoutYen: 4200, popularity: 1, lineKind: "payout" }], []), // exact
    v2(RK, "quinella", "refunded", "normal", [], refundLine),        // genuine refund stays refunded (exact)
    v2(RK, "win", "settled", "special_payout", specialPayout, []),   // special payout addition (no v1)
  ];
  applyReparseForDocument(db, repo, meta, derived, active, state, NOW);

  assert.equal(state.counts.false_refund_correction, 1);
  assert.equal(state.counts.special_payout_addition, 1);
  assert.equal(state.counts.exact, 2); // trifecta + quinella
  assert.equal(state.counts.appended_candidates, 2);
  assert.equal(state.counts.supersession_relations, 1);
  assert.equal(state.counts.fr_from_refunded, 1);

  // active resolver: exacta now settled, win present, quinella still refunded
  const after = loadActiveState(db, loadSourceDuplicateSet(db));
  assert.equal(after.active.get("2020-05-01:12:R1 exacta")?.status, "settled");
  assert.equal(after.active.get("2020-05-01:12:R1 win")?.status, "settled");
  assert.equal(after.active.get("2020-05-01:12:R1 quinella")?.status, "refunded");
  assert.equal(after.ambiguousKeys.size, 0);
  // computeAfter delta matches measured
  assert.deepEqual(computeAfter(active.before, state.counts), after.before);
  db.close();
});

test("rollback resolver restores v1 original counts without deleting corrected rows", () => {
  const { db, repo } = setup();
  insertV1(db, repo, RK, "exacta", "refunded", [], refundLine);
  insertV1(db, repo, RK, "trifecta", "settled", [{ selection: "1-2-3", payoutYen: 4200, popularity: 1, lineKind: "payout" }], []);
  insertV1(db, repo, RK, "quinella", "refunded", [], refundLine);
  const beforeV1 = activeStatusCounts(db, false); // {refunded:2, settled:1}
  const physicalBefore = physicalRowCount(db);

  applyReparseForDocument(db, repo, meta, [
    v2(RK, "exacta", "settled", "normal", settledPayout, []),
    v2(RK, "trifecta", "settled", "normal", [{ selection: "1-2-3", payoutYen: 4200, popularity: 1, lineKind: "payout" }], []),
    v2(RK, "quinella", "refunded", "normal", [], refundLine),
    v2(RK, "win", "settled", "special_payout", specialPayout, []),
  ], loadActiveState(db, loadSourceDuplicateSet(db)), newState(), NOW);

  const corrected = activeStatusCounts(db, false);
  const rolledBack = activeStatusCounts(db, true);
  assert.deepEqual(corrected, { settled: 3, refunded: 1 });
  // rollback は reparse candidate（訂正 exacta + 追加 win）を無視し、v1 original を復元する。
  assert.deepEqual(rolledBack, beforeV1);
  // append-only: 訂正行も v1 行も物理的に残る（rollback は削除しない）。
  assert.ok(physicalRowCount(db) > physicalBefore);
  db.close();
});

test("second apply on the same copy is a no-op (idempotent)", () => {
  const { db, repo } = setup();
  insertV1(db, repo, RK, "exacta", "refunded", [], refundLine);
  const derived = [
    v2(RK, "exacta", "settled", "normal", settledPayout, []),
    v2(RK, "win", "settled", "special_payout", specialPayout, []),
  ];
  const s1 = newState();
  applyReparseForDocument(db, repo, meta, derived, loadActiveState(db, loadSourceDuplicateSet(db)), s1, NOW);
  assert.equal(s1.counts.appended_candidates, 2);

  const s2 = newState();
  applyReparseForDocument(db, repo, meta, derived, loadActiveState(db, loadSourceDuplicateSet(db)), s2, NOW);
  assert.equal(s2.counts.appended_candidates, 0);
  assert.equal(s2.counts.supersession_relations, 0);
  assert.equal(s2.counts.exact, 2);
  assert.equal(lightIntegrity(db).multipleActiveSuccessors, 0);
  assert.equal(lightIntegrity(db).selfSupersedingCycles, 0);
  db.close();
});

test("append-only triggers reject UPDATE and DELETE on corrected candidates", () => {
  const { db, repo } = setup();
  insertV1(db, repo, RK, "exacta", "refunded", [], refundLine);
  applyReparseForDocument(db, repo, meta, [v2(RK, "exacta", "settled", "normal", settledPayout, [])],
    loadActiveState(db, loadSourceDuplicateSet(db)), newState(), NOW);
  const enforce = appendOnlyEnforcement(db);
  assert.equal(enforce.updateBlocked, true);
  assert.equal(enforce.deleteBlocked, true);
  assert.throws(() => db.prepare("UPDATE settlement_candidates_v2 SET settlement_status='refunded'").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM settlement_candidates_v2").run(), /append-only/);
  db.close();
});

test("ambiguous (non-defect) status differences are not corrected", () => {
  const { db, repo } = setup();
  insertV1(db, repo, RK, "exacta", "settled", settledPayout, []); // existing settled
  const state = newState();
  // v2 says refunded (not the defect direction) → ambiguous_non_defect, no append
  applyReparseForDocument(db, repo, meta, [v2(RK, "exacta", "refunded", "normal", [], refundLine)],
    loadActiveState(db, loadSourceDuplicateSet(db)), state, NOW);
  assert.equal(state.counts.ambiguous_non_defect, 1);
  assert.equal(state.counts.appended_candidates, 0);
  db.close();
});

test("unexpected addition (non-special v2-only) is flagged and not appended", () => {
  const { db, repo } = setup();
  const state = newState();
  applyReparseForDocument(db, repo, meta, [v2(RK, "exacta", "settled", "normal", settledPayout, [])],
    loadActiveState(db, loadSourceDuplicateSet(db)), state, NOW);
  assert.equal(state.counts.unexpected_addition, 1);
  assert.equal(state.counts.appended_candidates, 0);
  db.close();
});
