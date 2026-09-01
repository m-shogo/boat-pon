import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { semanticPayloadHash } from "./domain";
import { initializeN1CanonicalResolutionSchema, initializeN1SettlementSchema } from "./settlement";
import { detectExactDuplicateObservationsInRaw, planSourceDuplicateResolution } from "./n1CanonicalResolution";

const NOW = "2026-07-29T04:00:00.000Z";

function setupEmptyDuplicate() {
  const root = mkdtempSync(join(tmpdir(), "n1-canon-empty-test-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  db.exec("PRAGMA synchronous = OFF;");
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);

  const replay = new ResearchReplayRepository(db, new RawStore(join(root, "raw")), undefined, () => NOW);
  const raw = replay.recordRawDocument({ bytes: Buffer.from("empty-source-duplicate"), contentType: "text/plain", charset: "utf-8" });
  const parseRunId = `pr-${raw.rawDocumentId}`;
  db.prepare(`INSERT INTO parse_runs (parse_run_id,raw_document_id,parser_name,parser_version,source_schema_version,canonicalization_version,payload_type,status,warning_codes,error_code,started_at,completed_at,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,created_at) VALUES (?,?, 'p','v1','fam','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,'h',NULL,NULL,NULL,?)`).run(parseRunId, raw.rawDocumentId, NOW, NOW, NOW);

  const raceKey = "2008-07-20:12:R1";
  for (const observationId of ["obs-empty-1", "obs-empty-2"]) {
    const payload = {
      canonicalRaceKey: raceKey,
      sourceKind: "official_archive" as const,
      parseStatus: "success" as const,
      candidateCount: 0,
      diagnosticCodes: [] as string[],
    };
    const payloadHash = semanticPayloadHash("settlement_result", payload);
    db.prepare(`INSERT INTO domain_observations (observation_id,canonical_race_key,observation_type,payload_type,payload_schema_version,parse_run_id,raw_document_id,source_published_at,source_observed_at,first_seen_at,timing_quality,source_quality,measurement_quality,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,recorded_at,effective_at,created_at) VALUES (?,?,'settlement_result','settlement_result','rr-payload-v1',?,?,NULL,?,?,'observed_only','official_public','arc',?,NULL,NULL,NULL,?,?,?)`).run(observationId, raceKey, parseRunId, raw.rawDocumentId, NOW, NOW, payloadHash, NOW, NOW, NOW);
    db.prepare(`INSERT INTO typed_observation_payloads (observation_id,payload_type,payload_schema_version,payload_json,payload_hash,created_at) VALUES (?,'settlement_result','rr-payload-v1',?,?,?)`).run(observationId, JSON.stringify(payload), payloadHash, NOW);
  }

  return { db, rawDocumentId: raw.rawDocumentId };
}

test("empty candidate observations are not exact source duplicates", () => {
  const { db, rawDocumentId } = setupEmptyDuplicate();

  const plan = planSourceDuplicateResolution(db);
  assert.equal(plan.duplicatedRaces, 1);
  assert.equal(plan.plannedResolutions.length, 0);
  assert.equal(plan.valueConflicts.length, 1);
  assert.equal(plan.valueConflicts[0].valueEqual, false);

  const guard = detectExactDuplicateObservationsInRaw(db, rawDocumentId);
  assert.equal(guard.length, 1);
  assert.equal(guard[0].valueEqual, false);

  db.close();
});
