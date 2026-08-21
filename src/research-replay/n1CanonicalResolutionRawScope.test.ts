import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { planSourceDuplicateResolution } from "./n1CanonicalResolution";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { initializeN1CanonicalResolutionSchema, initializeN1SettlementSchema } from "./settlement";

const NOW = "2026-08-21T12:00:00.000Z";
const RACE = "2026-08-21:05:R3";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "n1-canonical-raw-scope-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);
  const replay = new ResearchReplayRepository(db, new RawStore(join(root, "raw")), undefined, () => NOW);
  const rawA = replay.recordRawDocument({ bytes: Buffer.from("archive-a"), contentType: "text/plain", charset: "utf-8" });
  const rawB = replay.recordRawDocument({ bytes: Buffer.from("archive-b"), contentType: "text/plain", charset: "utf-8" });
  return { db, rawA: rawA.rawDocumentId, rawB: rawB.rawDocumentId };
}

function insertParseRun(db: ReturnType<typeof openSidecarDatabase>, rawDocumentId: string, parseRunId: string): void {
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id,raw_document_id,parser_name,parser_version,source_schema_version,canonicalization_version,
     payload_type,status,warning_codes,error_code,started_at,completed_at,semantic_payload_hash,
     supersedes_id,correction_kind,correction_reason,created_at)
    VALUES (?,?, 'raw-scope-test','v1','scope-v1','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,'h',NULL,NULL,NULL,?)`)
    .run(parseRunId, rawDocumentId, NOW, NOW, NOW);
}

function insertObservation(input: {
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
            'official_public','raw-scope-test',?,NULL,NULL,NULL,?,?,?)`)
    .run(input.observationId, RACE, input.parseRunId, input.rawDocumentId, NOW, NOW, `${input.observationId}-hash`, NOW, NOW, NOW);
}

test("source duplicate planning isolates duplicate groups by raw document", () => {
  const { db, rawA, rawB } = setup();
  insertParseRun(db, rawA, "parse-a");
  insertParseRun(db, rawB, "parse-b");

  insertObservation({ db, observationId: "a-1", rawDocumentId: rawA, parseRunId: "parse-a" });
  insertObservation({ db, observationId: "a-2", rawDocumentId: rawA, parseRunId: "parse-a" });
  insertObservation({ db, observationId: "b-1", rawDocumentId: rawB, parseRunId: "parse-b" });

  const plan = planSourceDuplicateResolution(db);
  assert.equal(plan.duplicatedRaces, 1);
  assert.deepEqual(plan.plannedResolutions.map((item) => item.duplicateObservationId), ["a-2"]);
  assert.equal(plan.valueConflicts.length, 0);
  db.close();
});
