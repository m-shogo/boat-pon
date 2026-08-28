import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { detectExactDuplicateObservationsInRaw, planSourceDuplicateResolution } from "./n1CanonicalResolution";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { initializeN1CanonicalResolutionSchema, initializeN1SettlementSchema } from "./settlement";

const NOW = "2026-08-21T12:10:00.000Z";
const RACE = "2026-08-21:05:R4";

test("source duplicate resolution rejects observation parse/raw lineage drift", () => {
  const root = mkdtempSync(join(tmpdir(), "n1-canonical-parse-raw-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);
  const replay = new ResearchReplayRepository(db, new RawStore(join(root, "raw")), undefined, () => NOW);
  const rawA = replay.recordRawDocument({ bytes: Buffer.from("raw-a"), contentType: "text/plain", charset: "utf-8" });
  const rawB = replay.recordRawDocument({ bytes: Buffer.from("raw-b"), contentType: "text/plain", charset: "utf-8" });
  db.prepare("UPDATE raw_documents SET integrity_status='verified', security_scan_status='passed', parser_replay_eligible=1 WHERE raw_document_id IN (?,?)").run(rawA.rawDocumentId, rawB.rawDocumentId);

  db.prepare(`INSERT INTO parse_runs
    (parse_run_id,raw_document_id,parser_name,parser_version,source_schema_version,canonicalization_version,
     payload_type,status,warning_codes,error_code,started_at,completed_at,semantic_payload_hash,
     supersedes_id,correction_kind,correction_reason,created_at)
    VALUES ('parse-a',?, 'parse-raw-test','v1','scope-v1','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,'h',NULL,NULL,NULL,?)`)
    .run(rawA.rawDocumentId, NOW, NOW, NOW);

  for (const observationId of ["drift-a", "drift-b"]) {
    db.prepare(`INSERT INTO domain_observations
      (observation_id,canonical_race_key,observation_type,payload_type,payload_schema_version,parse_run_id,
       raw_document_id,source_published_at,source_observed_at,first_seen_at,timing_quality,source_quality,
       measurement_quality,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,
       recorded_at,effective_at,created_at)
      VALUES (?,?,'settlement_result','settlement_result','rr-payload-v1','parse-a',?,NULL,?,?,'observed_only',
              'official_public','parse-raw-test',?,NULL,NULL,NULL,?,?,?)`)
      .run(observationId, RACE, rawB.rawDocumentId, NOW, NOW, `${observationId}-hash`, NOW, NOW, NOW);
  }

  const plan = planSourceDuplicateResolution(db);
  assert.equal(plan.plannedResolutions.length, 0);
  assert.equal(plan.valueConflicts.length, 1);
  assert.equal(detectExactDuplicateObservationsInRaw(db, rawB.rawDocumentId)[0]?.valueEqual, false);
  db.close();
});

test("source duplicate planner and future-ingest guard reject ineligible raw evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "n1-canonical-raw-eligibility-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);
  const replay = new ResearchReplayRepository(db, new RawStore(join(root, "raw")), undefined, () => NOW);
  const raw = replay.recordRawDocument({ bytes: Buffer.from("raw-eligible"), contentType: "text/plain", charset: "utf-8" });
  db.prepare("UPDATE raw_documents SET integrity_status='verified', security_scan_status='passed', parser_replay_eligible=1 WHERE raw_document_id=?").run(raw.rawDocumentId);

  db.prepare(`INSERT INTO parse_runs
    (parse_run_id,raw_document_id,parser_name,parser_version,source_schema_version,canonicalization_version,
     payload_type,status,warning_codes,error_code,started_at,completed_at,semantic_payload_hash,
     supersedes_id,correction_kind,correction_reason,created_at)
    VALUES ('parse-eligible',?, 'parse-raw-test','v1','scope-v1','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,'h',NULL,NULL,NULL,?)`)
    .run(raw.rawDocumentId, NOW, NOW, NOW);

  for (const observationId of ["eligible-a", "eligible-b"]) {
    db.prepare(`INSERT INTO domain_observations
      (observation_id,canonical_race_key,observation_type,payload_type,payload_schema_version,parse_run_id,
       raw_document_id,source_published_at,source_observed_at,first_seen_at,timing_quality,source_quality,
       measurement_quality,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,
       recorded_at,effective_at,created_at)
      VALUES (?,?,'settlement_result','settlement_result','rr-payload-v1','parse-eligible',?,NULL,?,?,'observed_only',
              'official_public','parse-raw-test',?,NULL,NULL,NULL,?,?,?)`)
      .run(observationId, RACE, raw.rawDocumentId, NOW, NOW, `${observationId}-hash`, NOW, NOW, NOW);
  }

  const eligiblePlan = planSourceDuplicateResolution(db);
  assert.equal(eligiblePlan.plannedResolutions.length, 1);
  assert.equal(eligiblePlan.valueConflicts.length, 0);
  assert.equal(detectExactDuplicateObservationsInRaw(db, raw.rawDocumentId)[0]?.valueEqual, true);

  db.prepare("UPDATE raw_documents SET integrity_status='failed' WHERE raw_document_id=?").run(raw.rawDocumentId);

  const quarantinedPlan = planSourceDuplicateResolution(db);
  assert.equal(quarantinedPlan.plannedResolutions.length, 0);
  assert.equal(quarantinedPlan.valueConflicts.length, 1);
  assert.equal(detectExactDuplicateObservationsInRaw(db, raw.rawDocumentId)[0]?.valueEqual, false);
  db.close();
});
