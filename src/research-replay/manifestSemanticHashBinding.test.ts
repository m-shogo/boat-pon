import assert from "node:assert/strict";
import test from "node:test";
import { PAYLOAD_SCHEMA_VERSION } from "./domain";
import { RESOLUTION_POLICIES, strictPitGuard } from "./manifest";
import type { ResearchReplayRepository } from "./repository";

const RACE_KEY = "2026-08-21:01:R1";
const AS_OF = "2026-08-21T03:00:00.000Z";

function repository() {
  return {
    loadTypedPayload() {
      return {
        type: "beforeinfo",
        payload: {
          exhibitionTime: 6.8,
          exhibitionStartTiming: 0.05,
          windSpeedMps: 2,
          waveHeightCm: 1,
          observedOnly: false,
        },
      };
    },
  } as unknown as ResearchReplayRepository;
}

function observation(domainHash: string, typedHash: string) {
  return {
    observation_id: "beforeinfo-1",
    canonical_race_key: RACE_KEY,
    observation_type: "beforeinfo",
    payload_schema_version: PAYLOAD_SCHEMA_VERSION,
    parse_run_id: "parse-beforeinfo",
    raw_document_id: "raw-beforeinfo",
    parse_raw_document_id: "raw-beforeinfo",
    source_published_at: "2026-08-21T02:59:00.000Z",
    source_observed_at: "2026-08-21T03:00:00.000Z",
    first_seen_at: "2026-08-21T03:00:00.000Z",
    timing_quality: "source_exact" as const,
    source_quality: "official_public" as const,
    semantic_payload_hash: domainHash,
    typed_payload_hash: typedHash,
    parser_version: "rr-parser-test-v1",
    parse_status: "success",
  };
}

function guard(domainHash: string, typedHash: string) {
  return strictPitGuard({
    observation: observation(domainHash, typedHash),
    repository: repository(),
    canonicalRaceKey: RACE_KEY,
    asOfAt: AS_OF,
    policy: RESOLUTION_POLICIES.research_replay_strict_pre_race,
  });
}

test("PIT guard accepts an observation whose domain and typed semantic hashes agree", () => {
  const hash = "a".repeat(64);
  const result = guard(hash, hash);
  assert.equal(result.disposition, "accepted");
  assert.equal(result.codes.includes("SEMANTIC_PAYLOAD_HASH_MISMATCH"), false);
});

test("PIT guard rejects an observation whose domain semantic hash drifts from the typed payload hash", () => {
  const result = guard("a".repeat(64), "b".repeat(64));
  assert.equal(result.disposition, "rejected");
  assert.ok(result.codes.includes("SEMANTIC_PAYLOAD_HASH_MISMATCH"));
});
