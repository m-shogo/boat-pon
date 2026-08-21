import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { PAYLOAD_SCHEMA_VERSION, semanticPayloadHash } from "./domain";
import { buildN2PitAuditSummary } from "./n2PitAudit";
import { readN2PitAuditObservations } from "./n2PitAuditReader";

test("PIT audit rejects rehashed market payload with contradictory checkpoint semantics", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-pit-checkpoint-"));
  try {
    const primaryPath = join(root, "primary.sqlite");
    const sidecarPath = join(root, "sidecar.sqlite");

    const primary = new DatabaseSync(primaryPath);
    primary.exec(`
      CREATE TABLE official_programs (
        race_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        race_no INTEGER NOT NULL,
        close_at TEXT
      );
      INSERT INTO official_programs VALUES ('20240601-01-01','2024-06-01','01',1,'10:00');
    `);
    primary.close();

    const payload = {
      selections: [{ selection: "1-2-3", odds: 12.5 }],
      scheduledCloseObservationId: "schedule-1",
      scheduledCloseAtSeen: "2024-06-01T01:00:00.000Z",
      observedAt: "2024-06-01T00:55:00.000Z",
      minutesBeforeCloseAtCapture: 5,
      checkpointLabelAtCapture: "T-30" as const,
      checkpointPolicyVersion: "t-minus-nearest-v1",
      marketKind: "live_checkpoint" as const,
    };
    // The generic typed-payload hash accepts the shape. PIT must additionally verify
    // the frozen checkpoint semantics against the observed/close instants.
    const hash = semanticPayloadHash("trifecta_market", payload);

    const sidecar = new DatabaseSync(sidecarPath);
    sidecar.exec(`
      CREATE TABLE raw_documents (
        raw_document_id TEXT PRIMARY KEY,
        integrity_status TEXT NOT NULL,
        security_scan_status TEXT NOT NULL,
        parser_replay_eligible INTEGER NOT NULL
      );
      CREATE TABLE parse_runs (
        parse_run_id TEXT PRIMARY KEY,
        raw_document_id TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE domain_observations (
        observation_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        observation_type TEXT NOT NULL,
        payload_type TEXT NOT NULL,
        payload_schema_version TEXT NOT NULL,
        semantic_payload_hash TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        source_published_at TEXT,
        source_observed_at TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        timing_quality TEXT NOT NULL,
        source_quality TEXT NOT NULL
      );
      CREATE TABLE typed_observation_payloads (
        observation_id TEXT PRIMARY KEY,
        payload_type TEXT NOT NULL,
        payload_schema_version TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL
      );
      INSERT INTO raw_documents VALUES ('raw-1','verified','passed',1);
      INSERT INTO parse_runs VALUES ('parse-1','raw-1','success');
    `);
    sidecar.prepare(`INSERT INTO domain_observations VALUES (
      'obs-1','2024-06-01:01:R1','trifecta_market','trifecta_market',?, ?,
      'raw-1','parse-1',NULL,'2024-06-01T00:55:00.000Z','2024-06-01T00:55:01.000Z',
      'observed_only','official_public'
    )`).run(PAYLOAD_SCHEMA_VERSION, hash);
    sidecar.prepare(`INSERT INTO typed_observation_payloads VALUES (
      'obs-1','trifecta_market',?, ?, ?
    )`).run(PAYLOAD_SCHEMA_VERSION, JSON.stringify(payload), hash);
    sidecar.close();

    const result = readN2PitAuditObservations({
      primaryDbPath: primaryPath,
      sidecarDbPath: sidecarPath,
    });
    assert.equal(result.returnedObservationCount, 1);
    assert.equal(result.observations[0].typedPayloadIntegrity, "invalid");

    const summary = buildN2PitAuditSummary(result.observations);
    assert.equal(summary.status, "CONDITIONAL");
    assert.equal(summary.verifiedSafeCount, 0);
    assert.equal(summary.reasonCounts.excluded_lineage_typed_payload_invalid, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
