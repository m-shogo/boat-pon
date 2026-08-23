import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recordApprovalGrant } from "./approval";
import { CANONICALIZATION_VERSION } from "./canonical";
import { PAYLOAD_SCHEMA_VERSION, semanticPayloadHash } from "./domain";
import {
  applyOfficialProgramCanary,
  buildOfficialProgramCanaryManifest,
  officialProgramCanaryApprovalTarget,
  type OfficialProgramCanarySourceRow,
} from "./n2OfficialProgramCanary";
import {
  buildOfficialProgramObservationEnvelope,
  N2_OFFICIAL_PROGRAM_PARSER_VERSION,
  N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
} from "./n2OfficialProgramObservation";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

const CODE_SHA = "1234567890abcdef1234567890abcdef12345678";
const NOW = "2004-01-01T01:00:00.000Z";

type RawEligibility = {
  integrityStatus: "verified" | "quarantined";
  securityScanStatus: "passed" | "quarantined";
  parserReplayEligible: 0 | 1;
};

function raw(): string {
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

function sourceRow(): OfficialProgramCanarySourceRow {
  return {
    raceId: "20040101-01-01",
    date: "2004-01-01",
    venue: "桐生",
    raceNo: 1,
    closeAt: "23:00",
    sourceFile: "/private/cache/2004-01-01-01-1.json",
    rawJson: raw(),
    importedAt: "2004-01-01 01:00:00",
  };
}

function runCase(eligibility: RawEligibility): void {
  const dir = mkdtempSync(join(tmpdir(), "n2-program-canary-raw-eligibility-"));
  const db = openRolloutDatabase(join(dir, "sidecar.sqlite"));
  initializeRolloutSchema(db, "2004-01-01T00:00:00.000Z");
  let sequence = 0;
  const rawStore = new RawStore(join(dir, "raw"));
  const repository = new ResearchReplayRepository(
    db,
    rawStore,
    () => `raw-eligibility-${++sequence}`,
    () => NOW,
  );

  try {
    const row = sourceRow();
    const manifest = buildOfficialProgramCanaryManifest({
      rows: [row],
      cohort: { dateFrom: "2004-01-01", dateTo: "2004-01-07" },
      codeGitSha: CODE_SHA,
      generatedAt: "2004-01-08T00:00:00.000Z",
    });
    const item = manifest.binding.items[0];
    const bytes = Buffer.from(row.rawJson, "utf8");
    const write = rawStore.write({
      bytes,
      contentType: "application/json",
      charset: "utf-8",
    });
    const rawDocumentId = "raw-ineligible";
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
      eligibility.integrityStatus,
      write.relativePath,
      NOW,
      eligibility.parserReplayEligible,
      eligibility.securityScanStatus,
      NOW,
    );

    // Model previously persisted parse/observation evidence directly. raw_documents,
    // parse_runs, and observations are append-only, so a test must not manufacture
    // an impossible UPDATE merely to reach the canary's defense-in-depth check.
    const envelope = buildOfficialProgramObservationEnvelope({
      canonicalRaceKey: item.canonicalRaceKey,
      rawJson: row.rawJson,
      sourcePublishedAt: null,
      sourceObservedAt: item.sourceObservedAt,
      firstSeenAt: item.sourceObservedAt,
    });
    const payloadHash = semanticPayloadHash("official_program", envelope.payload);
    const parseRunId = "parse-ineligible";
    const observationId = "observation-ineligible";
    db.prepare(`
      INSERT INTO parse_runs (
        parse_run_id, raw_document_id, parser_name, parser_version,
        source_schema_version, canonicalization_version, payload_type, status,
        warning_codes, error_code, started_at, completed_at, semantic_payload_hash,
        supersedes_id, correction_kind, correction_reason, created_at
      ) VALUES (?, ?, 'n2-official-program', ?, ?, ?, 'official_program', 'success',
                '[]', NULL, ?, ?, ?, NULL, NULL, NULL, ?)
    `).run(
      parseRunId,
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
      ) VALUES (?, ?, 'official_program', 'official_program', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                NULL, NULL, NULL, ?, ?, ?)
    `).run(
      observationId,
      item.canonicalRaceKey,
      PAYLOAD_SCHEMA_VERSION,
      parseRunId,
      rawDocumentId,
      envelope.sourcePublishedAt,
      envelope.sourceObservedAt,
      envelope.firstSeenAt,
      envelope.timingQuality,
      envelope.sourceQuality,
      envelope.measurementQuality,
      payloadHash,
      NOW,
      envelope.effectiveAt,
      NOW,
    );
    db.prepare(`
      INSERT INTO typed_observation_payloads (
        observation_id, payload_type, payload_schema_version, payload_json, payload_hash, created_at
      ) VALUES (?, 'official_program', ?, ?, ?, ?)
    `).run(
      observationId,
      PAYLOAD_SCHEMA_VERSION,
      JSON.stringify(envelope.payload),
      payloadHash,
      NOW,
    );

    recordApprovalGrant(db, {
      approvalId: "approval-raw-eligibility",
      ...officialProgramCanaryApprovalTarget(manifest.manifestDigest),
      approvalSource: "human",
      approvalReference: "test://approval-raw-eligibility",
      approvedAt: "2004-01-01T00:45:00Z",
      approvalMode: "production",
    }, NOW);

    assert.throws(() => applyOfficialProgramCanary({
      db,
      repository,
      manifest,
      primaryRows: [row],
      gateInput: {
        executionMode: "production",
        rolloutStartedAt: "2004-01-01T02:00:00.000Z",
        onDisk: {
          codeGitSha: CODE_SHA,
          hasActiveWal: false,
          diskFreeBytes: Number.MAX_SAFE_INTEGER,
          neededBytes: 1,
          shadowWriteEnabled: false,
          killSwitchEngaged: false,
        },
      },
    }), /CANARY_RAW_DOCUMENT_INELIGIBLE/u);

    assert.equal((db.prepare("SELECT COUNT(*) n FROM capture_attempts").get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM domain_observations").get() as { n: number }).n, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("canary refuses a current observation backed by quarantined raw evidence", () => {
  runCase({
    integrityStatus: "quarantined",
    securityScanStatus: "passed",
    parserReplayEligible: 1,
  });
});

test("canary refuses a current observation backed by security-quarantined raw evidence", () => {
  runCase({
    integrityStatus: "verified",
    securityScanStatus: "quarantined",
    parserReplayEligible: 1,
  });
});

test("canary refuses a current observation backed by replay-ineligible raw evidence", () => {
  runCase({
    integrityStatus: "verified",
    securityScanStatus: "passed",
    parserReplayEligible: 0,
  });
});
