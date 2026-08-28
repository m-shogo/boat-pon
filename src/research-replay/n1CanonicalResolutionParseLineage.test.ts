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
  detectExactDuplicateObservationsInRaw,
  planSourceDuplicateResolution,
} from "./n1CanonicalResolution";

const NOW = "2026-08-21T09:40:00.000Z";
const RACE_KEY = "2026-08-21:05:R2";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "n1-canonical-parse-lineage-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);
  const replay = new ResearchReplayRepository(db, new RawStore(join(root, "raw")), undefined, () => NOW);
  const raw = replay.recordRawDocument({ bytes: Buffer.from("shared-settlement-source"), contentType: "text/plain", charset: "utf-8" });
  return { db, rawDocumentId: raw.rawDocumentId };
}

function insertParseRun(db: ReturnType<typeof openSidecarDatabase>, rawDocumentId: string, parseRunId: string): void {
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id,raw_document_id,parser_name,parser_version,source_schema_version,canonicalization_version,
     payload_type,status,warning_codes,error_code,started_at,completed_at,semantic_payload_hash,
     supersedes_id,correction_kind,correction_reason,created_at)
    VALUES (?,?, 'parse-lineage-test','v1','scope-v1','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,'h',NULL,NULL,NULL,?)`)
    .run(parseRunId, rawDocumentId, NOW, NOW, NOW);
}

function insertSettlementObservation(input: {
  db: ReturnType<typeof openSidecarDatabase>;
  observationId: string;
  rawDocumentId: string;
  parseRunId: string;
}): void {
  input.db.prepare(`INSERT INTO domain_observations
    (observation_id,canonical_race_key,observation_type,payload_type,payload_schema_version,parse_run_id,
     raw_document_id,source_published_at,source_observed_at,first_seen_at,timing_quality,source_quality,
     measurement_quality,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,
     recorded_at,effective_at,created_at)
    VALUES (?,?,'settlement_result','settlement_result','rr-payload-v1',?,?,NULL,?,?,'observed_only',
            'official_public','parse-lineage-test',?,NULL,NULL,NULL,?,?,?)`)
    .run(input.observationId, RACE_KEY, input.parseRunId, input.rawDocumentId, NOW, NOW, `${input.observationId}-hash`, NOW, NOW, NOW);
}

test("source-duplicate resolution refuses equal settlement observations from different parse runs", () => {
  const { db, rawDocumentId } = setup();
  insertParseRun(db, rawDocumentId, "parse-a");
  insertParseRun(db, rawDocumentId, "parse-b");
  insertSettlementObservation({ db, observationId: "settlement-a", rawDocumentId, parseRunId: "parse-a" });
  insertSettlementObservation({ db, observationId: "settlement-b", rawDocumentId, parseRunId: "parse-b" });

  const plan = planSourceDuplicateResolution(db);
  assert.equal(plan.duplicatedRaces, 1);
  assert.equal(plan.plannedResolutions.length, 0);
  assert.equal(plan.valueConflicts.length, 1);
  assert.equal(plan.valueConflicts[0].canonicalObservationId, "settlement-a");
  assert.equal(plan.valueConflicts[0].duplicateObservationId, "settlement-b");

  const guard = detectExactDuplicateObservationsInRaw(db, rawDocumentId);
  assert.equal(guard.length, 1);
  assert.equal(guard[0].valueEqual, false);
  db.close();
});

test("source-duplicate resolution still accepts equal observations from the same uncorrected parse run", () => {
  const { db, rawDocumentId } = setup();
  insertParseRun(db, rawDocumentId, "parse-a");
  insertSettlementObservation({ db, observationId: "settlement-a", rawDocumentId, parseRunId: "parse-a" });
  insertSettlementObservation({ db, observationId: "settlement-b", rawDocumentId, parseRunId: "parse-a" });

  const plan = planSourceDuplicateResolution(db);
  assert.equal(plan.plannedResolutions.length, 1);
  assert.equal(plan.valueConflicts.length, 0);
  assert.equal(detectExactDuplicateObservationsInRaw(db, rawDocumentId)[0].valueEqual, true);
  db.close();
});
