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
  SettlementRepository,
} from "./settlement";
import {
  applySourceDuplicateResolution,
  planSourceDuplicateResolution,
} from "./n1CanonicalResolution";

const NOW = "2026-07-29T04:00:00.000Z";
const RACE_KEY = "2008-07-06:12:R1";
let observationSequence = 0;

function setup(): { db: DatabaseSync; replay: ResearchReplayRepository } {
  const root = mkdtempSync(join(tmpdir(), "n1-canon-idempotency-test-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  db.exec("PRAGMA synchronous=OFF;");
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);
  return { db, replay: new ResearchReplayRepository(db, new RawStore(join(root, "raw")), undefined, () => NOW) };
}

function addObservationWithCandidates(db: DatabaseSync, replay: ResearchReplayRepository): string {
  const raw = replay.recordRawDocument({ bytes: Buffer.from(`canon-${RACE_KEY}`), contentType: "text/plain", charset: "utf-8" });
  const parseRunId = `pr-${raw.rawDocumentId}`;
  db.prepare(`INSERT OR IGNORE INTO parse_runs
    (parse_run_id,raw_document_id,parser_name,parser_version,source_schema_version,canonicalization_version,
     payload_type,status,warning_codes,error_code,started_at,completed_at,semantic_payload_hash,
     supersedes_id,correction_kind,correction_reason,created_at)
    VALUES (?,?, 'p','v1','fam','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,'h',NULL,NULL,NULL,?)`)
    .run(parseRunId, raw.rawDocumentId, NOW, NOW, NOW);
  const payload = {
    canonicalRaceKey: RACE_KEY,
    sourceKind: "official_archive" as const,
    parseStatus: "success" as const,
    candidateCount: 1,
    diagnosticCodes: [] as string[],
  };
  const observationId = `obs-idempotency-${++observationSequence}`;
  const payloadHash = semanticPayloadHash("settlement_result", payload);
  db.prepare(`INSERT INTO domain_observations
    (observation_id,canonical_race_key,observation_type,payload_type,payload_schema_version,parse_run_id,
     raw_document_id,source_published_at,source_observed_at,first_seen_at,timing_quality,source_quality,
     measurement_quality,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,
     recorded_at,effective_at,created_at)
    VALUES (?,?,'settlement_result','settlement_result','rr-payload-v1',?,?,NULL,?,?,'observed_only',
            'official_public','arc',?,NULL,NULL,NULL,?,?,?)`)
    .run(observationId, RACE_KEY, parseRunId, raw.rawDocumentId, NOW, NOW, payloadHash, NOW, NOW, NOW);
  db.prepare(`INSERT INTO typed_observation_payloads
    (observation_id,payload_type,payload_schema_version,payload_json,payload_hash,created_at)
    VALUES (?,'settlement_result','rr-payload-v1',?,?,?)`)
    .run(observationId, JSON.stringify(payload), payloadHash, NOW);
  const settlement = new SettlementRepository(db, () => `candidate-${observationId}-${Math.random().toString(36).slice(2)}`);
  for (const betType of BET_TYPES) {
    const selection = betType === "trifecta" || betType === "trio"
      ? "1-2-3"
      : betType === "win" || betType === "place"
        ? "1"
        : "1-2";
    settlement.appendCandidate({
      canonicalRaceKey: RACE_KEY,
      betType,
      settlementStatus: "settled",
      resultKind: "normal",
      revisionKind: "initial",
      resolutionStatus: "resolved",
      sourceKind: "official_archive",
      sourceSchemaVersion: "fam",
      observationId,
      parseRunId,
      rawDocumentId: raw.rawDocumentId,
      observedAt: NOW,
      payouts: [{ selection, payoutYen: 100 }],
      emitEvidencePins: false,
    });
  }
  return observationId;
}

test("source duplicate resolution rejects a conflicting immutable retry", () => {
  const { db, replay } = setup();
  addObservationWithCandidates(db, replay);
  const duplicateObservationId = addObservationWithCandidates(db, replay);
  const plan = planSourceDuplicateResolution(db);
  assert.equal(plan.plannedResolutions.length, 1);
  assert.equal(plan.plannedResolutions[0].duplicateObservationId, duplicateObservationId);

  const first = applySourceDuplicateResolution(db, plan, NOW);
  assert.deepEqual(first, { inserted: 1, noop: 0 });

  const conflictingPlan = structuredClone(plan);
  conflictingPlan.plannedResolutions[0].duplicateSemanticDigest = "0".repeat(64);
  assert.throws(
    () => applySourceDuplicateResolution(db, conflictingPlan, "2026-07-29T05:00:00.000Z"),
    /SOURCE_DUPLICATE_RESOLUTION_CONFLICT:/,
  );
  assert.equal(
    Number((db.prepare("SELECT COUNT(*) AS n FROM settlement_source_duplicate_resolutions_v2").get() as { n: number }).n),
    1,
  );
  db.close();
});

test("source duplicate resolution preserves exact retry idempotency across timestamps", () => {
  const { db, replay } = setup();
  addObservationWithCandidates(db, replay);
  addObservationWithCandidates(db, replay);
  const plan = planSourceDuplicateResolution(db);

  assert.deepEqual(applySourceDuplicateResolution(db, plan, NOW), { inserted: 1, noop: 0 });
  assert.deepEqual(
    applySourceDuplicateResolution(db, plan, "2026-07-29T05:00:00.000Z"),
    { inserted: 0, noop: 1 },
  );
  db.close();
});
