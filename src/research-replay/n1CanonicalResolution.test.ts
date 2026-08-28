import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { semanticPayloadHash } from "./domain";
import {
  BET_TYPES,
  initializeN1CanonicalResolutionSchema,
  initializeN1SettlementSchema,
  N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM,
  N1_CANONICAL_RESOLUTION_SCHEMA_VERSION,
  SettlementRepository,
  verifyN1CanonicalResolutionSchema,
  verifyN1SettlementSchema,
} from "./settlement";
import {
  applySourceDuplicateResolution,
  auditCanonicalDuplicates,
  detectExactDuplicateObservationsInRaw,
  planSourceDuplicateResolution,
} from "./n1CanonicalResolution";

const NOW = "2026-07-29T04:00:00.000Z";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "n1-canon-test-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  db.exec("PRAGMA synchronous = OFF;");
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  return { root, db, replay: new ResearchReplayRepository(db, new RawStore(join(root, "raw")), undefined, () => NOW) };
}

// 1 raw に、指定 raceKey の observation を1つ作り candidate を入れる。payoutYen で値を変えられる。
let obsSeq = 0;
function addObservationWithCandidates(db: DatabaseSync, replay: ResearchReplayRepository, raceKey: string, payoutYen: number): string {
  const raw = replay.recordRawDocument({ bytes: Buffer.from(`canon-${raceKey}`), contentType: "text/plain", charset: "utf-8" });
  const parseRunId = `pr-${raw.rawDocumentId}`;
  db.prepare(`INSERT OR IGNORE INTO parse_runs (parse_run_id,raw_document_id,parser_name,parser_version,source_schema_version,canonicalization_version,payload_type,status,warning_codes,error_code,started_at,completed_at,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,created_at) VALUES (?,?, 'p','v1','fam','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,'h',NULL,NULL,NULL,?)`).run(parseRunId, raw.rawDocumentId, NOW, NOW, NOW);
  const payload = { canonicalRaceKey: raceKey, sourceKind: "official_archive" as const, parseStatus: "success" as const, candidateCount: 1, diagnosticCodes: [] as string[] };
  const observationId = `obs-${++obsSeq}`;
  const ph = semanticPayloadHash("settlement_result", payload);
  db.prepare(`INSERT INTO domain_observations (observation_id,canonical_race_key,observation_type,payload_type,payload_schema_version,parse_run_id,raw_document_id,source_published_at,source_observed_at,first_seen_at,timing_quality,source_quality,measurement_quality,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,recorded_at,effective_at,created_at) VALUES (?,?,'settlement_result','settlement_result','rr-payload-v1',?,?,NULL,?,?,'observed_only','official_public','arc',?,NULL,NULL,NULL,?,?,?)`).run(observationId, raceKey, parseRunId, raw.rawDocumentId, NOW, NOW, ph, NOW, NOW, NOW);
  db.prepare(`INSERT INTO typed_observation_payloads (observation_id,payload_type,payload_schema_version,payload_json,payload_hash,created_at) VALUES (?,'settlement_result','rr-payload-v1',?,?,?)`).run(observationId, JSON.stringify(payload), ph, NOW);
  const settlement = new SettlementRepository(db, () => `cand-${observationId}-${Math.random().toString(36).slice(2)}`);
  for (const betType of BET_TYPES) {
    const selection = betType === "trifecta" || betType === "trio" ? "1-2-3" : betType === "win" || betType === "place" ? "1" : "1-2";
    settlement.appendCandidate({
      canonicalRaceKey: raceKey, betType, settlementStatus: "settled", resultKind: "normal", revisionKind: "initial",
      resolutionStatus: "resolved", sourceKind: "official_archive", sourceSchemaVersion: "fam", observationId,
      parseRunId, rawDocumentId: raw.rawDocumentId, observedAt: NOW, payouts: [{ selection, payoutYen }], emitEvidencePins: false,
    });
  }
  return observationId;
}

test("n1-settlement.0.3 is expand-only (0.1/0.2 unchanged), append-only", () => {
  const { db } = setup();
  assert.equal(verifyN1SettlementSchema(db).appendOnlyTriggerCount, 14);
  initializeN1CanonicalResolutionSchema(db, NOW);
  assert.equal(verifyN1SettlementSchema(db).ok, true);
  assert.equal(verifyN1SettlementSchema(db).appendOnlyTriggerCount, 14); // 0.1 不変
  const v = verifyN1CanonicalResolutionSchema(db);
  assert.equal(v.ok, true);
  assert.equal(v.version, N1_CANONICAL_RESOLUTION_SCHEMA_VERSION);
  assert.equal(v.checksumMatches, true);
  assert.equal(v.appendOnlyTriggerCount, 2);
  assert.equal((db.prepare("PRAGMA foreign_key_check").all()).length, 0);
  db.close();
});

test("checksum mismatch on 0.3 is default-deny", () => {
  const { db } = setup();
  db.prepare(`INSERT INTO n1_schema_migrations VALUES (?,?,?,?,?,'partial')`).run("bad", N1_CANONICAL_RESOLUTION_SCHEMA_VERSION, "0".repeat(64), NOW, process.version);
  assert.throws(() => initializeN1CanonicalResolutionSchema(db, NOW), /checksum mismatch/);
  assert.notEqual(N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM, "0".repeat(64));
  db.close();
});

test("exact source-duplicate observation → raw preserved, canonical unique, idempotent", () => {
  const { db, replay } = setup();
  initializeN1CanonicalResolutionSchema(db, NOW);
  const race = "2008-07-06:12:R1";
  const o1 = addObservationWithCandidates(db, replay, race, 100); // canonical (first, lowest rowid)
  const o2 = addObservationWithCandidates(db, replay, race, 100); // exact duplicate
  void o1; void o2;
  const before = auditCanonicalDuplicates(db);
  assert.equal(before.rawObservations, 2);
  assert.equal(before.rawDuplicateObservations, 1);
  assert.equal(before.rawRaceLevelDuplicateCandidates, 7); // 7 bet types duplicated
  assert.equal(before.activeDuplicateObservations, 1); // まだ未解決
  assert.equal(before.activeCanonicalRaceLevelDuplicateCandidates, 7);

  const plan = planSourceDuplicateResolution(db);
  assert.equal(plan.duplicatedRaces, 1);
  assert.equal(plan.plannedResolutions.length, 1);
  assert.equal(plan.valueConflicts.length, 0);
  assert.equal(plan.plannedResolutions[0].canonicalObservationId, o1); // source順で最初
  assert.equal(plan.plannedResolutions[0].duplicateObservationId, o2);
  assert.equal(plan.plannedResolutions[0].sourceArchiveFile, "k080706.lzh");

  const applied = applySourceDuplicateResolution(db, plan, NOW);
  assert.equal(applied.inserted, 1);

  const after = auditCanonicalDuplicates(db);
  // raw は不変
  assert.equal(after.rawObservations, 2);
  assert.equal(after.rawDuplicateObservations, 1);
  assert.equal(after.rawCandidates, before.rawCandidates);
  assert.equal(after.rawRaceLevelDuplicateCandidates, 7);
  // canonical は 0
  assert.equal(after.activeDuplicateObservations, 0);
  assert.equal(after.activeCanonicalRaceLevelDuplicateCandidates, 0);
  assert.equal(after.resolvedDuplicateObservations, 1);

  // 冪等: rerun で new 0
  const rerun = applySourceDuplicateResolution(db, planSourceDuplicateResolution(db), NOW);
  assert.equal(rerun.inserted, 0);
  assert.equal(rerun.noop, 1);
  // raw provenance: 両 observation とも accessible
  assert.equal((db.prepare("SELECT COUNT(*) c FROM domain_observations").get() as { c: number }).c, 2);
  // append-only: resolution row の UPDATE/DELETE は trigger で拒否
  assert.throws(() => db.prepare("UPDATE settlement_source_duplicate_resolutions_v2 SET resolution_kind='x'").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM settlement_source_duplicate_resolutions_v2").run(), /append-only/);
  db.close();
});

test("same race key with DIFFERENT payout values is NOT source_duplicate → conflict, apply refuses", () => {
  const { db, replay } = setup();
  initializeN1CanonicalResolutionSchema(db, NOW);
  const race = "2009-04-06:12:R1";
  addObservationWithCandidates(db, replay, race, 100);
  addObservationWithCandidates(db, replay, race, 250); // 値が異なる
  const plan = planSourceDuplicateResolution(db);
  assert.equal(plan.plannedResolutions.length, 0);
  assert.equal(plan.valueConflicts.length, 1);
  assert.throws(() => applySourceDuplicateResolution(db, plan, NOW), /value conflicts/);
  // 何も解決されない → active duplicate は残る（conflict path で別途扱う）
  assert.equal(auditCanonicalDuplicates(db).resolvedDuplicateObservations, 0);
  db.close();
});

test("future ingest guard detects exact duplicate observations within a raw and flags value conflicts", () => {
  const { db, replay } = setup();
  initializeN1CanonicalResolutionSchema(db, NOW);
  addObservationWithCandidates(db, replay, "2008-07-13:12:R1", 100); // 同一bytes→同一raw
  addObservationWithCandidates(db, replay, "2008-07-13:12:R1", 100); // exact dup（同一raw共有）
  const rawId = (db.prepare("SELECT raw_document_id r FROM domain_observations WHERE canonical_race_key=? LIMIT 1").get("2008-07-13:12:R1") as { r: string }).r;
  const exactHits = detectExactDuplicateObservationsInRaw(db, rawId);
  assert.equal(exactHits.length, 1);
  assert.equal(exactHits[0].valueEqual, true);

  // value 差の raw（別bytes→別raw）
  addObservationWithCandidates(db, replay, "2008-07-13:12:R2", 100);
  const rawId2 = (db.prepare("SELECT raw_document_id r FROM domain_observations WHERE canonical_race_key=? LIMIT 1").get("2008-07-13:12:R2") as { r: string }).r;
  // R2 は 1 observation のみ → guard は空
  assert.equal(detectExactDuplicateObservationsInRaw(db, rawId2).length, 0);
  db.close();
});
