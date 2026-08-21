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

test("parser-reparse observations do not block source-duplicate resolution or inflate source-observation audit", () => {
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
  db.close();
});
