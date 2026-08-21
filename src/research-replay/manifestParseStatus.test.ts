import assert from "node:assert/strict";
import test from "node:test";
import { PAYLOAD_SCHEMA_VERSION } from "./domain";
import { RESOLUTION_POLICIES, strictPitGuard } from "./manifest";
import type { ResearchReplayRepository } from "./repository";

const RACE_KEY = "2026-08-21:01:R1";
const AS_OF = "2026-08-21T03:00:00.000Z";

function observation(parseStatus: string) {
  return {
    observation_id: `obs-${parseStatus}`,
    canonical_race_key: RACE_KEY,
    observation_type: "race_schedule",
    payload_schema_version: PAYLOAD_SCHEMA_VERSION,
    parse_run_id: `parse-${parseStatus}`,
    raw_document_id: `raw-${parseStatus}`,
    source_published_at: "2026-08-21T01:00:00.000Z",
    source_observed_at: "2026-08-21T01:00:01.000Z",
    first_seen_at: "2026-08-21T01:00:01.000Z",
    timing_quality: "source_exact" as const,
    source_quality: "official_public" as const,
    semantic_payload_hash: "a".repeat(64),
    parser_version: "rr-parser-test-v1",
    parse_status: parseStatus,
  };
}

const repository = {
  loadTypedPayload() {
    return { type: "race_schedule", payload: {} };
  },
} as unknown as ResearchReplayRepository;

test("PIT guard rejects observations produced by failed or unknown-schema parse runs", () => {
  for (const parseStatus of ["error", "unknown_schema"]) {
    const result = strictPitGuard({
      observation: observation(parseStatus),
      repository,
      canonicalRaceKey: RACE_KEY,
      asOfAt: AS_OF,
      policy: RESOLUTION_POLICIES.research_replay_strict_pre_race,
    });

    assert.equal(result.disposition, "rejected");
    assert.ok(result.codes.includes("PARSE_STATUS_NOT_REUSABLE"));
  }
});

test("PIT guard keeps reusable parse-run states eligible", () => {
  for (const parseStatus of ["success", "warning"]) {
    const result = strictPitGuard({
      observation: observation(parseStatus),
      repository,
      canonicalRaceKey: RACE_KEY,
      asOfAt: AS_OF,
      policy: RESOLUTION_POLICIES.research_replay_strict_pre_race,
    });

    assert.equal(result.disposition, "accepted");
    assert.equal(result.codes.includes("PARSE_STATUS_NOT_REUSABLE"), false);
  }
});
