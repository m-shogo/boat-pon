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

const NOW = "2026-08-21T09:45:00.000Z";
const RACE_KEY = "2026-08-21:05:R3";
const SHARED_SEMANTIC_HASH = "same-semantic";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "n1-canonical-correction-scope-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);
  const replay = new ResearchReplayRepository(db, new RawStore(join(root, "raw")), undefined, () => NOW);
  const raw = replay.recordRawDocument({ bytes: Buffer.from("same-source-corrected-later"), contentType: "text/plain", charset: "utf-8" });
  return { db, rawDocumentId: raw.rawDocumentId };
}

function insertParseRun(db: ReturnType<typeof openSidecarDatabase>, rawDocumentId: string, parseRunId: string): void {
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id,raw_document_id,parser_name,parser_version,source_schema_version,canonicalization_version,
     payload_type,status,warning_codes,error_code,started_at,completed_at,semantic_payload_hash,
     supersedes_id,correction_kind,correction_reason,created_at)
    VALUES (?,?, 'correction-scope-test','v1','scope-v1','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,'h',NULL,NULL,NULL,?)`)
    .run(parseRunId, rawDocumentId, NOW, NOW, NOW);
}

function insertObservation(input: {
  db: ReturnType<typeof openSidecarDatabase>;
  observationId: string;
  rawDocumentId: string;
  parseRunId: string;
  correctionKind?: string | null;
  correctionReason?: string | null;
}): void {
  input.db.prepare(`INSERT INTO domain_observations
    (observation_id,canonical_race_key,observation_type,payload_type,payload_schema_version,parse_run_id,
     raw_document_id,source_published_at,source_observed_at,first_seen_at,timing_quality,source_quality,
     measurement_quality,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,
     recorded_at,effective_at,created_at)
    VALUES (?,?,'settlement_result','settlement_result','rr-payload-v1',?,?,NULL,?,?,'observed_only',
            'official_public','correction-scope-test',?,NULL,?,?, ?,?,?)`)
    .run(
      input.observationId,
      RACE_KEY,
      input.parseRunId,
      input.rawDocumentId,
      NOW,
      NOW,
      `${input.observationId}-hash`,
      input.correctionKind ?? null,
      input.correctionReason ?? null,
      NOW,
      NOW,
      NOW,
    );
}

function insertCandidate(input: {
  db: ReturnType<typeof openSidecarDatabase>;
  candidateId: string;
  observationId: string;
  rawDocumentId: string;
  parseRunId: string;
  revisionKind: "initial" | "parser_reparse";
  canonicalRaceKey?: string;
  betType?: "win" | "place";
  semanticHash?: string;
  correctionReason?: string | null;
}): void {
  input.db.prepare(`INSERT INTO settlement_candidates_v2
    (candidate_id,canonical_race_key,bet_type,settlement_status,result_kind,revision_kind,resolution_status,
     source_kind,source_schema_version,observation_id,parse_run_id,raw_document_id,semantic_hash,
     supersedes_candidate_id,correction_reason,observed_at,created_at)
    VALUES (?,?,?,'settled','normal',?,'resolved','official_archive','scope-v1',?,?,?,?,NULL,?,?,?)`)
    .run(
      input.candidateId,
      input.canonicalRaceKey ?? RACE_KEY,
      input.betType ?? "win",
      input.revisionKind,
      input.observationId,
      input.parseRunId,
      input.rawDocumentId,
      input.semanticHash ?? SHARED_SEMANTIC_HASH,
      input.correctionReason ?? null,
      NOW,
      NOW,
    );
}

test("parser-reparse observations and candidates do not inflate source-duplicate audit", () => {
  const { db, rawDocumentId } = setup();
  insertParseRun(db, rawDocumentId, "parse-original");
  insertParseRun(db, rawDocumentId, "parse-reparse");
  insertObservation({ db, observationId: "settlement-original", rawDocumentId, parseRunId: "parse-original" });
  insertObservation({
    db,
    observationId: "settlement-reparse",
    rawDocumentId,
    parseRunId: "parse-reparse",
    correctionKind: "parser_reparse",
    correctionReason: "TEST_REPARSE",
  });
  insertCandidate({
    db,
    candidateId: "candidate-original",
    observationId: "settlement-original",
    rawDocumentId,
    parseRunId: "parse-original",
    revisionKind: "initial",
  });
  insertCandidate({
    db,
    candidateId: "candidate-reparse",
    observationId: "settlement-reparse",
    rawDocumentId,
    parseRunId: "parse-reparse",
    revisionKind: "parser_reparse",
    correctionReason: "TEST_REPARSE",
  });

  const plan = planSourceDuplicateResolution(db);
  assert.equal(plan.duplicatedRaces, 0);
  assert.equal(plan.plannedResolutions.length, 0);
  assert.equal(plan.valueConflicts.length, 0);
  assert.equal(detectExactDuplicateObservationsInRaw(db, rawDocumentId).length, 0);

  const audit = auditCanonicalDuplicates(db);
  assert.equal(audit.rawObservations, 1);
  assert.equal(audit.rawDistinctRaceKeys, 1);
  assert.equal(audit.rawDuplicateObservations, 0);
  assert.equal(audit.activeDuplicateObservations, 0);
  assert.equal(audit.rawCandidates, 1);
  assert.equal(audit.rawDistinctRaceBetHash, 1);
  assert.equal(audit.rawRaceLevelDuplicateCandidates, 0);
  assert.equal(audit.activeCandidates, 1);
  assert.equal(audit.activeDistinctRaceBetHash, 1);
  assert.equal(audit.activeCanonicalRaceLevelDuplicateCandidates, 0);
  db.close();
});

test("revision candidates attached to uncorrected observations do not alter source-duplicate planning or audit", () => {
  const { db, rawDocumentId } = setup();
  insertParseRun(db, rawDocumentId, "parse-original");
  insertObservation({ db, observationId: "settlement-original-a", rawDocumentId, parseRunId: "parse-original" });
  insertObservation({ db, observationId: "settlement-original-b", rawDocumentId, parseRunId: "parse-original" });
  insertCandidate({
    db,
    candidateId: "candidate-original-a",
    observationId: "settlement-original-a",
    rawDocumentId,
    parseRunId: "parse-original",
    revisionKind: "initial",
  });
  insertCandidate({
    db,
    candidateId: "candidate-original-b",
    observationId: "settlement-original-b",
    rawDocumentId,
    parseRunId: "parse-original",
    revisionKind: "initial",
  });
  insertCandidate({
    db,
    candidateId: "candidate-revision-b",
    observationId: "settlement-original-b",
    rawDocumentId,
    parseRunId: "parse-original",
    revisionKind: "parser_reparse",
    betType: "place",
    semanticHash: "revision-semantic",
    correctionReason: "TEST_REPARSE",
  });

  const plan = planSourceDuplicateResolution(db);
  assert.equal(plan.duplicatedRaces, 1);
  assert.equal(plan.plannedResolutions.length, 1);
  assert.equal(plan.valueConflicts.length, 0);

  const detected = detectExactDuplicateObservationsInRaw(db, rawDocumentId);
  assert.equal(detected.length, 1);
  assert.equal(detected[0]?.valueEqual, true);

  const audit = auditCanonicalDuplicates(db);
  assert.equal(audit.rawObservations, 2);
  assert.equal(audit.rawDistinctRaceKeys, 1);
  assert.equal(audit.rawDuplicateObservations, 1);
  assert.equal(audit.rawCandidates, 2);
  assert.equal(audit.rawDistinctRaceBetHash, 1);
  assert.equal(audit.rawRaceLevelDuplicateCandidates, 1);
  db.close();
});

test("candidate race drift cannot be auto-resolved as an exact source duplicate", () => {
  const { db, rawDocumentId } = setup();
  insertParseRun(db, rawDocumentId, "parse-original");
  insertObservation({ db, observationId: "settlement-original-a", rawDocumentId, parseRunId: "parse-original" });
  insertObservation({ db, observationId: "settlement-original-b", rawDocumentId, parseRunId: "parse-original" });
  insertCandidate({
    db,
    candidateId: "candidate-original-a",
    observationId: "settlement-original-a",
    rawDocumentId,
    parseRunId: "parse-original",
    revisionKind: "initial",
  });
  insertCandidate({
    db,
    candidateId: "candidate-original-b",
    observationId: "settlement-original-b",
    rawDocumentId,
    parseRunId: "parse-original",
    revisionKind: "initial",
    canonicalRaceKey: "2026-08-21:05:R4",
  });

  const plan = planSourceDuplicateResolution(db);
  assert.equal(plan.duplicatedRaces, 1);
  assert.equal(plan.plannedResolutions.length, 0);
  assert.equal(plan.valueConflicts.length, 1);

  const detected = detectExactDuplicateObservationsInRaw(db, rawDocumentId);
  assert.equal(detected.length, 1);
  assert.equal(detected[0]?.valueEqual, false);

  const audit = auditCanonicalDuplicates(db);
  assert.equal(audit.rawObservations, 2);
  assert.equal(audit.rawDistinctRaceKeys, 1);
  assert.equal(audit.rawCandidates, 2);
  assert.equal(audit.rawDistinctRaceBetHash, 1);
  assert.equal(audit.rawRaceLevelDuplicateCandidates, 1);
  assert.equal(audit.activeCandidates, 2);
  assert.equal(audit.activeDistinctRaceBetHash, 1);
  assert.equal(audit.activeCanonicalRaceLevelDuplicateCandidates, 1);
  db.close();
});
