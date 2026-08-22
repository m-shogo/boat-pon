import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "./canonical";
import { PAYLOAD_SCHEMA_VERSION } from "./domain";
import { RESOLUTION_POLICIES, strictPitGuard } from "./manifest";
import type { ResearchReplayRepository } from "./repository";

const RACE_KEY = "2026-08-21:01:R1";
const AS_OF = "2026-08-21T03:00:00.000Z";
const MARKET_OBSERVATION_ID = "market-1";
const SCHEDULE_OBSERVATION_ID = "schedule-1";
const CLOSE_AT = "2026-08-21T03:05:00.000Z";

type Schedule = { canonicalRaceKey: string; scheduledCloseAt: string };
type ScheduleLineageOverride = Partial<{
  canonicalRaceKey: string;
  observationType: string;
  payloadSchemaVersion: string;
  semanticPayloadHash: string;
}>;

function marketObservation() {
  return {
    observation_id: MARKET_OBSERVATION_ID,
    canonical_race_key: RACE_KEY,
    observation_type: "trifecta_market",
    payload_schema_version: PAYLOAD_SCHEMA_VERSION,
    parse_run_id: "parse-market",
    raw_document_id: "raw-market",
    parse_raw_document_id: "raw-market",
    source_published_at: null,
    source_observed_at: "2026-08-21T03:00:00.000Z",
    first_seen_at: "2026-08-21T03:00:00.000Z",
    timing_quality: "observed_only" as const,
    source_quality: "official_public" as const,
    semantic_payload_hash: "a".repeat(64),
    parser_version: "rr-parser-test-v1",
    parse_status: "success",
  };
}

function scheduleSemanticHash(schedule: Schedule): string {
  return canonicalHash({
    payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
    payloadType: "race_schedule",
    payload: schedule,
  });
}

function repository(schedule: Schedule | null, lineageOverride: ScheduleLineageOverride = {}) {
  const scheduleLineage = schedule === null ? undefined : {
    canonical_race_key: lineageOverride.canonicalRaceKey ?? schedule.canonicalRaceKey,
    observation_type: lineageOverride.observationType ?? "race_schedule",
    payload_schema_version: lineageOverride.payloadSchemaVersion ?? PAYLOAD_SCHEMA_VERSION,
    semantic_payload_hash: lineageOverride.semanticPayloadHash ?? scheduleSemanticHash(schedule),
  };
  return {
    db: {
      prepare() {
        return {
          get(observationId: string) {
            return observationId === SCHEDULE_OBSERVATION_ID ? scheduleLineage : undefined;
          },
        };
      },
    },
    loadTypedPayload(observationId: string) {
      if (observationId === MARKET_OBSERVATION_ID) {
        return {
          type: "trifecta_market",
          payload: {
            selections: [],
            scheduledCloseObservationId: SCHEDULE_OBSERVATION_ID,
            scheduledCloseAtSeen: CLOSE_AT,
            observedAt: "2026-08-21T03:00:00.000Z",
            minutesBeforeCloseAtCapture: 5,
            checkpointLabelAtCapture: "T-5",
            checkpointPolicyVersion: "t-minus-nearest-v1",
            marketKind: "live_checkpoint",
          },
        };
      }
      if (observationId === SCHEDULE_OBSERVATION_ID && schedule !== null) {
        return { type: "race_schedule", payload: schedule };
      }
      throw new Error(`PAYLOAD_REFERENCE_MISSING:${observationId}`);
    },
  } as unknown as ResearchReplayRepository;
}

function guard(schedule: Schedule | null, lineageOverride: ScheduleLineageOverride = {}) {
  return strictPitGuard({
    observation: marketObservation(),
    repository: repository(schedule, lineageOverride),
    canonicalRaceKey: RACE_KEY,
    asOfAt: AS_OF,
    policy: RESOLUTION_POLICIES.research_replay_strict_pre_race,
  });
}

test("PIT guard accepts a market checkpoint bound to the referenced schedule version", () => {
  const result = guard({ canonicalRaceKey: RACE_KEY, scheduledCloseAt: CLOSE_AT });
  assert.equal(result.disposition, "accepted");
  assert.equal(result.codes.includes("SCHEDULE_VERSION_INVALID"), false);
});

test("PIT guard rejects a market checkpoint whose schedule reference is missing", () => {
  const result = guard(null);
  assert.equal(result.disposition, "rejected");
  assert.ok(result.codes.includes("SCHEDULE_VERSION_INVALID"));
});

test("PIT guard rejects a market checkpoint bound to a different race schedule", () => {
  const result = guard({ canonicalRaceKey: "2026-08-21:02:R1", scheduledCloseAt: CLOSE_AT });
  assert.equal(result.disposition, "rejected");
  assert.ok(result.codes.includes("SCHEDULE_VERSION_INVALID"));
});

test("PIT guard rejects a market checkpoint whose frozen close differs from the referenced schedule", () => {
  const result = guard({ canonicalRaceKey: RACE_KEY, scheduledCloseAt: "2026-08-21T03:10:00.000Z" });
  assert.equal(result.disposition, "rejected");
  assert.ok(result.codes.includes("SCHEDULE_VERSION_INVALID"));
});

test("PIT guard rejects schedule payloads detached from their observation type lineage", () => {
  const result = guard(
    { canonicalRaceKey: RACE_KEY, scheduledCloseAt: CLOSE_AT },
    { observationType: "beforeinfo" },
  );
  assert.equal(result.disposition, "rejected");
  assert.ok(result.codes.includes("SCHEDULE_VERSION_INVALID"));
});

test("PIT guard rejects rehashed schedule payloads detached from observation semantic lineage", () => {
  const result = guard(
    { canonicalRaceKey: RACE_KEY, scheduledCloseAt: CLOSE_AT },
    { semanticPayloadHash: "b".repeat(64) },
  );
  assert.equal(result.disposition, "rejected");
  assert.ok(result.codes.includes("SCHEDULE_VERSION_INVALID"));
});
