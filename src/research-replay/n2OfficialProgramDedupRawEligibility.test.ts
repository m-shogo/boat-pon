import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CANONICALIZATION_VERSION } from "./canonical";
import { PAYLOAD_SCHEMA_VERSION, semanticPayloadHash } from "./domain";
import {
  buildOfficialProgramObservationEnvelope,
  captureOfficialProgramObservation,
  N2_OFFICIAL_PROGRAM_PARSER_VERSION,
  N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
} from "./n2OfficialProgramObservation";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";

const NOW = "2004-01-01T01:00:00.000Z";
const RACE_KEY = "2004-01-01:01:R1";

function rawJson(): string {
  return JSON.stringify({
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      registrationNo: String(4000 + index),
      className: index === 0 ? "A1" : "B1",
      nationalWinRate: 6 + index / 10,
      nationalTop2Rate: 40 + index,
      localWinRate: 5 + index / 10,
      localTop2Rate: 35 + index,
      motorTop2Rate: 30 + index,
      boatTop2Rate: 28 + index,
    })),
  });
}

function runCase(input: {
  integrityStatus: "verified" | "quarantined";
  securityScanStatus: "passed" | "quarantined";
  parserReplayEligible: 0 | 1;
}): void {
  const root = mkdtempSync(join(tmpdir(), "n2-program-dedup-raw-eligibility-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  const rawStore = new RawStore(join(root, "raw"));
  let sequence = 0;
  const repository = new ResearchReplayRepository(db, rawStore, () => `dedup-${++sequence}`, () => NOW);

  try {
    const bytes = Buffer.from(rawJson(), "utf8");
    const write = rawStore.write({ bytes, contentType: "application/json", charset: "utf-8" });
    const rawDocumentId = "raw-existing";
    db.prepare(`
      INSERT INTO raw_documents (
        raw_document_id, raw_sha256, entity_body_byte_length, content_type, charset,
        content_encoding, compressed_byte_length, decompression_ratio, integrity_status,
        storage_type, storage_path, first_recorded_at, retention_class,
        parser_replay_eligible, security_scan_status, created_at
      ) VALUES (?, ?, ?, 'application/json', 'utf-8', NULL, NULL, ?, ?,
                'content_addressed_filesystem', ?, ?, 'research_evidence', ?, ?, ?)
    `).run(
      rawDocumentId,
      write.rawSha256,
      write.byteLength,
      write.decompressionRatio,
      input.integrityStatus,
      write.relativePath,
      NOW,
      input.parserReplayEligible,
      input.securityScanStatus,
      NOW,
    );

    const envelope = buildOfficialProgramObservationEnvelope({
      canonicalRaceKey: RACE_KEY,
      rawJson: rawJson(),
      sourcePublishedAt: null,
      sourceObservedAt: NOW,
      firstSeenAt: NOW,
    });
    const payloadHash = semanticPayloadHash("official_program", envelope.payload);
    db.prepare(`
      INSERT INTO parse_runs (
        parse_run_id, raw_document_id, parser_name, parser_version,
        source_schema_version, canonicalization_version, payload_type, status,
        warning_codes, error_code, started_at, completed_at, semantic_payload_hash,
        supersedes_id, correction_kind, correction_reason, created_at
      ) VALUES ('parse-existing', ?, 'n2-official-program', ?, ?, ?, 'official_program',
                'success', '[]', NULL, ?, ?, ?, NULL, NULL, NULL, ?)
    `).run(
      rawDocumentId,
      N2_OFFICIAL_PROGRAM_PARSER_VERSION,
      N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
      CANONICALIZATION_VERSION,
      NOW,
      NOW,
      payloadHash,
      NOW,
    );
    db.prepare(`
      INSERT INTO domain_observations (
        observation_id, canonical_race_key, observation_type, payload_type,
        payload_schema_version, parse_run_id, raw_document_id, source_published_at,
        source_observed_at, first_seen_at, timing_quality, source_quality,
        measurement_quality, semantic_payload_hash, supersedes_id, correction_kind,
        correction_reason, recorded_at, effective_at, created_at
      ) VALUES ('obs-existing', ?, 'official_program', 'official_program', ?, 'parse-existing', ?,
                NULL, ?, ?, 'observed_only', 'official_public', 'official_program_raw', ?,
                NULL, NULL, NULL, ?, NULL, ?)
    `).run(RACE_KEY, PAYLOAD_SCHEMA_VERSION, rawDocumentId, NOW, NOW, payloadHash, NOW, NOW);
    db.prepare(`
      INSERT INTO typed_observation_payloads (
        observation_id, payload_type, payload_schema_version, payload_json, payload_hash, created_at
      ) VALUES ('obs-existing', 'official_program', ?, ?, ?, ?)
    `).run(PAYLOAD_SCHEMA_VERSION, JSON.stringify(envelope.payload), payloadHash, NOW);

    assert.throws(() => captureOfficialProgramObservation({
      repository,
      logicalRequestGroupId: "dedup-group",
      canonicalRaceKey: RACE_KEY,
      sourceUrl: "https://example.invalid/program",
      requestStartedAt: "2004-01-01T00:59:58.000Z",
      responseHeadersReceivedAt: "2004-01-01T00:59:59.000Z",
      bodyCompletedAt: NOW,
      sourcePublishedAt: null,
      sourceObservedAt: NOW,
      firstSeenAt: NOW,
      rawJson: rawJson(),
      httpStatus: 200,
    }), /RAW_DOCUMENT_REPLAY_INELIGIBLE/u);

    const terminal = db.prepare(`
      SELECT event_kind, failure_reason
      FROM capture_attempt_events
      WHERE event_kind IN ('body_completed','capture_failed','capture_cancelled')
    `).all() as Array<{ event_kind: string; failure_reason: string | null }>;
    assert.deepEqual(terminal, [{ event_kind: "body_completed", failure_reason: null }]);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM capture_raw_links").get() as { n: number }).n, 1);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM parse_runs").get() as { n: number }).n, 1);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM domain_observations").get() as { n: number }).n, 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const [name, eligibility] of [
  ["quarantined integrity", { integrityStatus: "quarantined", securityScanStatus: "passed", parserReplayEligible: 1 }],
  ["quarantined security", { integrityStatus: "verified", securityScanStatus: "quarantined", parserReplayEligible: 1 }],
  ["replay-disabled", { integrityStatus: "verified", securityScanStatus: "passed", parserReplayEligible: 0 }],
] as const) {
  test(`official program capture refuses ${name} raw on same-SHA dedup reuse`, () => runCase(eligibility));
}
