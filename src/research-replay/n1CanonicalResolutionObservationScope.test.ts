import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import {
  initializeN1CanonicalResolutionSchema,
  initializeN1SettlementSchema,
} from "./settlement";
import {
  auditCanonicalDuplicates,
  detectExactDuplicateObservationsInRaw,
  planSourceDuplicateResolution,
} from "./n1CanonicalResolution";

const NOW = "2026-08-21T09:30:00.000Z";
const RACE_KEY = "2026-08-21:05:R1";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "n1-canonical-observation-scope-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);
  const replay = new ResearchReplayRepository(db, new RawStore(join(root, "raw")), undefined, () => NOW);
  const raw = replay.recordRawDocument({ bytes: Buffer.from("shared-race-evidence"), contentType: "text/plain", charset: "utf-8" });
  const parseRunId = `parse-${raw.rawDocumentId}`;
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id,raw_document_id,parser_name,parser_version,source_schema_version,canonicalization_version,
     payload_type,status,warning_codes,error_code,started_at,completed_at,semantic_payload_hash,
     supersedes_id,correction_kind,correction_reason,created_at)
    VALUES (?,?, 'scope-test','v1','scope-v1','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,'h',NULL,NULL,NULL,?)`)
    .run(parseRunId, raw.rawDocumentId, NOW, NOW, NOW);
  return { db, rawDocumentId: raw.rawDocumentId, parseRunId };
}

function insertObservation(input: {
  db: ReturnType<typeof openSidecarDatabase>;
  observationId: string;
  observationType: "official_program" | "settlement_result";
  rawDocumentId: string;
  parseRunId: string;
}): void {
  input.db.prepare(`INSERT INTO domain_observations
    (observation_id,canonical_race_key,observation_type,payload_type,payload_schema_version,parse_run_id,
     raw_document_id,source_published_at,source_observed_at,first_seen_at,timing_quality,source_quality,
     measurement_quality,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,
     recorded_at,effective_at,created_at)
    VALUES (?,?,?,?, 'rr-payload-v1',?,?,NULL,?,?,'observed_only','official_public','scope-test',?,NULL,NULL,NULL,?,?,?)`)
    .run(
      input.observationId,
      RACE_KEY,
      input.observationType,
      input.observationType,
      input.parseRunId,
      input.rawDocumentId,
      NOW,
      NOW,
      `${input.observationType}-hash`,
      NOW,
      NOW,
      NOW,
    );
}

test("N1 canonical duplicate resolution ignores non-settlement observations on the same race", () => {
  const { db, rawDocumentId, parseRunId } = setup();
  insertObservation({ db, observationId: "program-1", observationType: "official_program", rawDocumentId, parseRunId });
  insertObservation({ db, observationId: "settlement-1", observationType: "settlement_result", rawDocumentId, parseRunId });

  const before = planSourceDuplicateResolution(db);
  assert.equal(before.duplicatedRaces, 0);
  assert.equal(before.plannedResolutions.length, 0);
  assert.equal(before.valueConflicts.length, 0);
  assert.deepEqual(auditCanonicalDuplicates(db), {
    rawObservations: 1,
    rawDistinctRaceKeys: 1,
    rawDuplicateObservations: 0,
    activeDuplicateObservations: 0,
    rawCandidates: 0,
    rawDistinctRaceBetHash: 0,
    rawRaceLevelDuplicateCandidates: 0,
    activeCandidates: 0,
    activeDistinctRaceBetHash: 0,
    activeCanonicalRaceLevelDuplicateCandidates: 0,
    resolvedDuplicateObservations: 0,
  });
  assert.equal(detectExactDuplicateObservationsInRaw(db, rawDocumentId).length, 0);

  insertObservation({ db, observationId: "settlement-2", observationType: "settlement_result", rawDocumentId, parseRunId });
  const after = planSourceDuplicateResolution(db);
  assert.equal(after.duplicatedRaces, 1);
  assert.equal(after.plannedResolutions.length, 1);
  assert.equal(after.valueConflicts.length, 0);
  assert.equal(after.plannedResolutions[0].canonicalObservationId, "settlement-1");
  assert.equal(after.plannedResolutions[0].duplicateObservationId, "settlement-2");
  assert.equal(detectExactDuplicateObservationsInRaw(db, rawDocumentId).length, 1);
  db.close();
});
