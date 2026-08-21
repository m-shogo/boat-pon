import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalHash } from "./canonical";
import { semanticPayloadHash } from "./domain";
import { requireBackfillObservationContract } from "./n1Backfill";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { N1_SETTLEMENT_PARSER_VERSION } from "./settlement";

const NOW = "2026-07-25T04:00:00.000Z";
const RACE_KEY = "2026-06-30:01:R1";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "n1-backfill-observation-lineage-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  const rawStore = new RawStore(join(root, "raw"));
  const replay = new ResearchReplayRepository(db, rawStore, undefined, () => NOW);
  const raw = replay.recordRawDocument({
    bytes: Buffer.from("archive-fixture"),
    contentType: "text/plain",
    charset: "shift_jis",
  });
  const parseRunId = `n1bf-parse-${raw.rawDocumentId}`;
  db.prepare(`
    INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind,
     correction_reason, created_at)
    VALUES (?, ?, 'n1-backfill-archive', ?, 'modern_seven_display',
            'rr-c14n-v1', 'settlement_result', 'success', '[]', NULL,
            ?, ?, ?, NULL, NULL, NULL, ?)
  `).run(
    parseRunId,
    raw.rawDocumentId,
    N1_SETTLEMENT_PARSER_VERSION,
    NOW,
    NOW,
    canonicalHash({ file: "k260630.lzh" }),
    NOW,
  );
  return { db, rawDocumentId: raw.rawDocumentId, parseRunId };
}

function expectedPayload(candidateCount = 1) {
  const payload = {
    canonicalRaceKey: RACE_KEY,
    sourceKind: "official_archive" as const,
    parseStatus: "success" as const,
    candidateCount,
    diagnosticCodes: [] as string[],
  };
  return {
    payload,
    payloadJson: JSON.stringify(payload),
    payloadHash: semanticPayloadHash("settlement_result", payload),
  };
}

function insertObservation(input: {
  db: ReturnType<typeof openSidecarDatabase>;
  observationId: string;
  parseRunId: string;
  rawDocumentId: string;
  raceKey?: string;
  candidateCount?: number;
}) {
  const raceKey = input.raceKey ?? RACE_KEY;
  const { payloadJson, payloadHash } = expectedPayload(input.candidateCount ?? 1);
  input.db.prepare(`
    INSERT INTO domain_observations
    (observation_id, canonical_race_key, observation_type, payload_type, payload_schema_version,
     parse_run_id, raw_document_id, source_published_at, source_observed_at, first_seen_at,
     timing_quality, source_quality, measurement_quality, semantic_payload_hash, supersedes_id,
     correction_kind, correction_reason, recorded_at, effective_at, created_at)
    VALUES (?, ?, 'settlement_result', 'settlement_result', 'rr-payload-v1', ?, ?, NULL, ?, ?,
            'observed_only', 'official_public', 'official_archive', ?, NULL, NULL, NULL, ?, ?, ?)
  `).run(
    input.observationId,
    raceKey,
    input.parseRunId,
    input.rawDocumentId,
    NOW,
    NOW,
    payloadHash,
    NOW,
    NOW,
    NOW,
  );
  input.db.prepare(`
    INSERT INTO typed_observation_payloads
    (observation_id, payload_type, payload_schema_version, payload_json, payload_hash, created_at)
    VALUES (?, 'settlement_result', 'rr-payload-v1', ?, ?, ?)
  `).run(input.observationId, payloadJson, payloadHash, NOW);
  return { payloadJson, payloadHash };
}

test("backfill observation retry rejects an existing observation with different race lineage", () => {
  const { db, rawDocumentId, parseRunId } = setup();
  const observationId = `n1bf-obs-${rawDocumentId}-1`;
  insertObservation({
    db,
    observationId,
    parseRunId,
    rawDocumentId,
    raceKey: "2026-06-30:01:R2",
  });
  const expected = expectedPayload();
  assert.throws(() => requireBackfillObservationContract({
    db,
    observationId,
    canonicalRaceKey: RACE_KEY,
    parseRunId,
    rawDocumentId,
    semanticPayloadHash: expected.payloadHash,
    payloadJson: expected.payloadJson,
  }), /N1_BACKFILL_OBSERVATION_CONFLICT/);
  db.close();
});

test("backfill observation retry rejects a stale typed payload body", () => {
  const { db, rawDocumentId, parseRunId } = setup();
  const observationId = `n1bf-obs-${rawDocumentId}-1`;
  insertObservation({
    db,
    observationId,
    parseRunId,
    rawDocumentId,
    candidateCount: 2,
  });
  const expected = expectedPayload(1);
  assert.throws(() => requireBackfillObservationContract({
    db,
    observationId,
    canonicalRaceKey: RACE_KEY,
    parseRunId,
    rawDocumentId,
    semanticPayloadHash: expected.payloadHash,
    payloadJson: expected.payloadJson,
  }), /N1_BACKFILL_OBSERVATION_CONFLICT/);
  db.close();
});

test("backfill observation retry accepts the exact immutable observation and payload lineage", () => {
  const { db, rawDocumentId, parseRunId } = setup();
  const observationId = `n1bf-obs-${rawDocumentId}-1`;
  const expected = insertObservation({ db, observationId, parseRunId, rawDocumentId });
  assert.doesNotThrow(() => requireBackfillObservationContract({
    db,
    observationId,
    canonicalRaceKey: RACE_KEY,
    parseRunId,
    rawDocumentId,
    semanticPayloadHash: expected.payloadHash,
    payloadJson: expected.payloadJson,
  }));
  db.close();
});
