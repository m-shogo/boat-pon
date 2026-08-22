import assert from "node:assert/strict";
import test from "node:test";
import { PAYLOAD_SCHEMA_VERSION } from "./domain";
import { RESOLUTION_POLICIES, strictPitGuard } from "./manifest";
import type { ResearchReplayRepository } from "./repository";

const repository = {
  loadTypedPayload: () => ({ type: "beforeinfo", payload: {} }),
} as unknown as ResearchReplayRepository;

const baseObservation = {
  observation_id: "observation-1",
  canonical_race_key: "2026-08-02:01:R1",
  observation_type: "beforeinfo",
  payload_schema_version: PAYLOAD_SCHEMA_VERSION,
  parse_run_id: "parse-1",
  raw_document_id: "raw-1",
  source_published_at: "2026-08-02T03:00:00.000Z",
  source_observed_at: "2026-08-02T03:00:00.000Z",
  first_seen_at: "2026-08-02T03:00:00.000Z",
  timing_quality: "source_exact" as const,
  source_quality: "official_public" as const,
  semantic_payload_hash: "a".repeat(64),
  parser_version: "rr-parser-v1",
  parse_status: "success",
} satisfies Parameters<typeof strictPitGuard>[0]["observation"];

for (const [field, value] of [
  ["source_observed_at", "2026-08-02T12:00:00+09:00"],
  ["source_published_at", "2026-08-02T24:00:00.000Z"],
  ["first_seen_at", "2026-02-30T03:00:00.000Z"],
] as const) {
  test(`PIT manifest rejects non-canonical persisted ${field}`, () => {
    const result = strictPitGuard({
      observation: { ...baseObservation, [field]: value },
      repository,
      canonicalRaceKey: baseObservation.canonical_race_key,
      asOfAt: "2026-08-02T04:00:00.000Z",
      policy: RESOLUTION_POLICIES.research_replay_strict_pre_race,
    });

    assert.equal(result.disposition, "rejected");
    assert.ok(result.codes.includes("TIMESTAMP_UNKNOWN"));
  });
}
