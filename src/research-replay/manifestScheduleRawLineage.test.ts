import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PAYLOAD_SCHEMA_VERSION } from "./domain";
import { RESOLUTION_POLICIES, strictPitGuard } from "./manifest";
import type { ResearchReplayRepository } from "./repository";

const RACE_KEY = "2026-08-21:01:R1";
const AS_OF = "2026-08-21T03:00:00.000Z";
const CLOSE_AT = "2026-08-21T03:05:00.000Z";
const SCHEDULE_HASH = "b".repeat(64);

function marketObservation() {
  return {
    observation_id: "market-1",
    canonical_race_key: RACE_KEY,
    observation_type: "trifecta_market",
    payload_schema_version: PAYLOAD_SCHEMA_VERSION,
    parse_run_id: "parse-market",
    raw_document_id: "raw-market",
    parse_raw_document_id: "raw-market",
    raw_integrity_status: "verified",
    raw_security_scan_status: "passed",
    raw_parser_replay_eligible: 1,
    source_published_at: null,
    source_observed_at: AS_OF,
    first_seen_at: AS_OF,
    timing_quality: "observed_only" as const,
    source_quality: "official_public" as const,
    semantic_payload_hash: "a".repeat(64),
    parser_version: "rr-parser-test-v1",
    parse_status: "success",
  };
}

function repository(
  scheduleIntegrity: "verified" | "failed",
  scheduleDomainHash: string = SCHEDULE_HASH,
): ResearchReplayRepository {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE domain_observations (
      observation_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      observation_type TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      supersedes_id TEXT,
      source_quality TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      semantic_payload_hash TEXT NOT NULL
    );
    CREATE TABLE parse_runs (
      parse_run_id TEXT PRIMARY KEY,
      raw_document_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE raw_documents (
      raw_document_id TEXT PRIMARY KEY,
      integrity_status TEXT NOT NULL,
      security_scan_status TEXT NOT NULL,
      parser_replay_eligible INTEGER NOT NULL
    );
    CREATE TABLE typed_observation_payloads (
      observation_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO raw_documents VALUES(?,?,?,?)`).run(
    "raw-schedule", scheduleIntegrity, "passed", 1,
  );
  db.prepare(`INSERT INTO parse_runs VALUES(?,?,?)`).run(
    "parse-schedule", "raw-schedule", "success",
  );
  db.prepare(`INSERT INTO domain_observations VALUES(?,?,?,?,?,?,?,?,?)`).run(
    "schedule-1",
    RACE_KEY,
    "race_schedule",
    "2026-08-21T02:59:00.000Z",
    null,
    "official_public",
    "parse-schedule",
    "raw-schedule",
    scheduleDomainHash,
  );
  db.prepare(`INSERT INTO typed_observation_payloads VALUES(?,?)`).run("schedule-1", SCHEDULE_HASH);
  return {
    db,
    loadTypedPayload(observationId: string) {
      if (observationId === "market-1") {
        return {
          type: "trifecta_market",
          payload: {
            selections: [],
            scheduledCloseObservationId: "schedule-1",
            scheduledCloseAtSeen: CLOSE_AT,
            observedAt: AS_OF,
            minutesBeforeCloseAtCapture: 5,
            checkpointLabelAtCapture: "T-5",
            checkpointPolicyVersion: "t-minus-nearest-v1",
            marketKind: "live_checkpoint",
          },
        };
      }
      if (observationId === "schedule-1") {
        return {
          type: "race_schedule",
          payload: { canonicalRaceKey: RACE_KEY, scheduledCloseAt: CLOSE_AT },
        };
      }
      throw new Error(`PAYLOAD_REFERENCE_MISSING:${observationId}`);
    },
  } as unknown as ResearchReplayRepository;
}

function guard(
  scheduleIntegrity: "verified" | "failed",
  scheduleDomainHash: string = SCHEDULE_HASH,
) {
  const repo = repository(scheduleIntegrity, scheduleDomainHash);
  try {
    return strictPitGuard({
      observation: marketObservation(),
      repository: repo,
      canonicalRaceKey: RACE_KEY,
      asOfAt: AS_OF,
      policy: RESOLUTION_POLICIES.research_replay_strict_pre_race,
    });
  } finally {
    repo.db.close();
  }
}

test("manifest PIT guard accepts a market bound to an eligible schedule lineage", () => {
  const result = guard("verified");
  assert.equal(result.disposition, "accepted");
  assert.equal(result.codes.includes("SCHEDULE_VERSION_INVALID"), false);
});

test("manifest PIT guard rejects a market bound to a schedule whose raw integrity failed", () => {
  const result = guard("failed");
  assert.equal(result.disposition, "rejected");
  assert.ok(result.codes.includes("SCHEDULE_VERSION_INVALID"));
});

test("manifest PIT guard rejects a market bound to a schedule with domain-to-typed semantic hash drift", () => {
  const result = guard("verified", "c".repeat(64));
  assert.equal(result.disposition, "rejected");
  assert.ok(result.codes.includes("SCHEDULE_VERSION_INVALID"));
});
