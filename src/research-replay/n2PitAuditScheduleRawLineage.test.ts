import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PAYLOAD_SCHEMA_VERSION, semanticPayloadHash } from "./domain";
import { readN2PitAuditObservations } from "./n2PitAuditReader";

function createPrimary(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE official_programs (
        race_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        race_no INTEGER NOT NULL,
        close_at TEXT
      );
      INSERT INTO official_programs(race_id,date,venue,race_no,close_at)
      VALUES('20240601-01-01','2024-06-01','01',1,'10:00');
    `);
  } finally {
    db.close();
  }
}

function createSidecar(path: string, scheduleIntegrityStatus: "verified" | "failed"): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
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
    `);

    const insertRaw = db.prepare(`INSERT INTO raw_documents VALUES(?,?,?,?)`);
    const insertParse = db.prepare(`INSERT INTO parse_runs VALUES(?,?,?)`);
    const insertObservation = db.prepare(`INSERT INTO domain_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertPayload = db.prepare(`INSERT INTO typed_observation_payloads VALUES(?,?,?,?,?)`);

    const canonicalRaceKey = "2024-06-01:01:R1";
    const schedulePayload = {
      canonicalRaceKey,
      scheduledCloseAt: "2024-06-01T01:00:00.000Z",
      scheduledCloseOriginalOffset: "+09:00",
      scheduleStatus: "scheduled",
    };
    const scheduleHash = semanticPayloadHash("race_schedule", schedulePayload);
    insertRaw.run("raw-schedule", scheduleIntegrityStatus, "passed", 1);
    insertParse.run("parse-schedule", "raw-schedule", "success");
    insertObservation.run(
      "schedule-1",
      canonicalRaceKey,
      "race_schedule",
      "race_schedule",
      PAYLOAD_SCHEMA_VERSION,
      scheduleHash,
      "raw-schedule",
      "parse-schedule",
      "2024-06-01T00:00:00.000Z",
      "2024-06-01T00:00:00.000Z",
      "2024-06-01T00:00:01.000Z",
      "source_exact",
      "official_public",
    );
    insertPayload.run(
      "schedule-1",
      "race_schedule",
      PAYLOAD_SCHEMA_VERSION,
      JSON.stringify(schedulePayload),
      scheduleHash,
    );

    const marketObservedAt = "2024-06-01T00:55:00.000Z";
    const marketPayload = {
      selections: [{ selection: "1-2-3", odds: 12.5 }],
      scheduledCloseObservationId: "schedule-1",
      scheduledCloseAtSeen: "2024-06-01T01:00:00.000Z",
      observedAt: marketObservedAt,
      minutesBeforeCloseAtCapture: 5,
      checkpointLabelAtCapture: "T-5",
      checkpointPolicyVersion: "t-minus-nearest-v1",
      marketKind: "live_checkpoint",
    };
    const marketHash = semanticPayloadHash("trifecta_market", marketPayload);
    insertRaw.run("raw-market", "verified", "passed", 1);
    insertParse.run("parse-market", "raw-market", "success");
    insertObservation.run(
      "market-1",
      canonicalRaceKey,
      "trifecta_market",
      "trifecta_market",
      PAYLOAD_SCHEMA_VERSION,
      marketHash,
      "raw-market",
      "parse-market",
      null,
      marketObservedAt,
      "2024-06-01T00:55:01.000Z",
      "observed_only",
      "official_public",
    );
    insertPayload.run(
      "market-1",
      "trifecta_market",
      PAYLOAD_SCHEMA_VERSION,
      JSON.stringify(marketPayload),
      marketHash,
    );
  } finally {
    db.close();
  }
}

function marketIntegrity(scheduleIntegrityStatus: "verified" | "failed"): "verified" | "invalid" | undefined {
  const dir = mkdtempSync(join(tmpdir(), "n2-pit-schedule-lineage-"));
  try {
    const primary = join(dir, "boat.sqlite");
    const sidecar = join(dir, "research-replay.sqlite");
    createPrimary(primary);
    createSidecar(sidecar, scheduleIntegrityStatus);
    const result = readN2PitAuditObservations({ primaryDbPath: primary, sidecarDbPath: sidecar });
    return result.observations.find((observation) => observation.observationType === "trifecta_market")?.typedPayloadIntegrity;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("PIT audit accepts a market only when its schedule raw lineage is eligible", () => {
  assert.equal(marketIntegrity("verified"), "verified");
});

test("PIT audit rejects a market whose referenced schedule raw document failed integrity", () => {
  assert.equal(marketIntegrity("failed"), "invalid");
});
