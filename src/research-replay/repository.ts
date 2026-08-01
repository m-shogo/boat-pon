import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CANONICALIZATION_VERSION, canonicalHash, canonicalUtcTimestamp } from "./canonical";
import {
  PAYLOAD_SCHEMA_VERSION,
  type ObservationType,
  semanticPayloadHash,
  validateTypedPayload,
} from "./domain";
import { parseCanonicalRaceKey } from "./identity";
import { allowlistedHeaders, RawStore, redactSourceUrl, type RawWriteInput } from "./rawStore";

export type CaptureEventKind =
  | "capture_started"
  | "response_headers_received"
  | "body_completed"
  | "capture_failed"
  | "capture_cancelled";

export type CaptureFailureReason =
  | "network_not_reached"
  | "timeout"
  | "partial_body"
  | "hash_mismatch"
  | "process_crash_detected"
  | "cancelled"
  | "unsupported_content_type"
  | "body_too_large"
  | "decompression_limit"
  | "unknown_charset";

export type CaptureState = "incomplete" | "succeeded" | "failed" | "cancelled";

export type FixtureEnvelope = {
  sourceSchemaVersion: string;
  payloadType: ObservationType;
  canonicalRaceKey: string;
  payload: unknown;
  sourcePublishedAt: string | null;
  sourceObservedAt: string;
  firstSeenAt: string;
  timingQuality: "source_exact" | "observed_only" | "ambiguous" | "unknown";
  sourceQuality: "official_public" | "derived_existing_row" | "sanitized_fixture";
  measurementQuality: string;
  effectiveAt: string | null;
  warningCodes?: string[];
};

export type ParseResult = {
  parseRunId: string;
  observationId: string | null;
  status: "success" | "warning" | "error" | "unknown_schema";
  semanticPayloadHash: string | null;
  errorCode: string | null;
};

type IdFactory = () => string;

function nowIso(): string {
  return new Date().toISOString();
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export class ResearchReplayRepository {
  constructor(
    readonly db: DatabaseSync,
    readonly rawStore: RawStore,
    private readonly idFactory: IdFactory = randomUUID,
    private readonly clock: () => string = nowIso,
  ) {}

  createCaptureAttempt(input: {
    captureAttemptId?: string;
    logicalRequestGroupId: string;
    canonicalRaceKey?: string | null;
    sourceUrl: string;
    method: "GET" | "LOCAL_FIXTURE" | "EXISTING_CACHE";
    requestStartedAt: string;
    sourceType: string;
  }): string {
    if (input.canonicalRaceKey) parseCanonicalRaceKey(input.canonicalRaceKey);
    const id = input.captureAttemptId ?? this.idFactory();
    this.db.prepare(`
      INSERT INTO capture_attempts
      (capture_attempt_id, logical_request_group_id, canonical_race_key, source_url_redacted,
       method, request_started_at, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.logicalRequestGroupId,
      input.canonicalRaceKey ?? null,
      redactSourceUrl(input.sourceUrl),
      input.method,
      canonicalUtcTimestamp(input.requestStartedAt),
      input.sourceType,
      this.clock(),
    );
    return id;
  }

  addRaceIdentityAlias(input: {
    aliasId?: string;
    canonicalRaceKey: string;
    sourceType: string;
    sourceRaceId: string;
    sourceUrl?: string | null;
    observedAt: string;
  }): string {
    parseCanonicalRaceKey(input.canonicalRaceKey);
    const id = input.aliasId ?? this.idFactory();
    this.db.prepare(`
      INSERT INTO race_identity_aliases
      (alias_id, canonical_race_key, source_type, source_race_id,
       source_url_redacted, observed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.canonicalRaceKey,
      input.sourceType,
      input.sourceRaceId,
      input.sourceUrl ? redactSourceUrl(input.sourceUrl) : null,
      canonicalUtcTimestamp(input.observedAt),
      this.clock(),
    );
    return id;
  }

  addCaptureEvent(input: {
    eventId?: string;
    captureAttemptId: string;
    eventKind: CaptureEventKind;
    occurredAt: string;
    httpStatus?: number | null;
    failureReason?: CaptureFailureReason | null;
    responseHeaders?: Record<string, string> | null;
    byteCount?: number | null;
    detail?: unknown;
  }): string {
    const terminalFailure = input.eventKind === "capture_failed" || input.eventKind === "capture_cancelled";
    if (terminalFailure && !input.failureReason) throw new Error("failure reason required for terminal failure");
    if (!terminalFailure && input.failureReason) throw new Error("failure reason only allowed on failure/cancelled");
    if (input.eventKind === "body_completed" && input.byteCount == null) {
      throw new Error("byte count required for completed body");
    }
    const occurredAt = canonicalUtcTimestamp(input.occurredAt);
    const attempt = this.db.prepare(`
      SELECT request_started_at FROM capture_attempts WHERE capture_attempt_id = ?
    `).get(input.captureAttemptId) as { request_started_at: string } | undefined;
    if (!attempt) throw new Error("capture attempt missing");
    if (Date.parse(occurredAt) < Date.parse(attempt.request_started_at)) {
      throw new Error("capture event precedes request start");
    }
    const latest = this.db.prepare(`
      SELECT occurred_at FROM capture_attempt_events
      WHERE capture_attempt_id = ?
      ORDER BY occurred_at DESC, event_id DESC
      LIMIT 1
    `).get(input.captureAttemptId) as { occurred_at: string } | undefined;
    if (latest && Date.parse(occurredAt) < Date.parse(latest.occurred_at)) {
      throw new Error("capture event time regressed");
    }
    const id = input.eventId ?? this.idFactory();
    this.db.prepare(`
      INSERT INTO capture_attempt_events
      (event_id, capture_attempt_id, event_kind, occurred_at, http_status, failure_reason,
       response_header_metadata, byte_count, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.captureAttemptId,
      input.eventKind,
      occurredAt,
      input.httpStatus ?? null,
      input.failureReason ?? null,
      input.responseHeaders ? safeJson(allowlistedHeaders(input.responseHeaders)) : null,
      input.byteCount ?? null,
      input.detail === undefined ? null : safeJson(input.detail),
      this.clock(),
    );
    return id;
  }

  captureState(captureAttemptId: string): CaptureState {
    const row = this.db.prepare(`
      SELECT event_kind
      FROM capture_attempt_events
      WHERE capture_attempt_id = ?
        AND event_kind IN ('body_completed', 'capture_failed', 'capture_cancelled')
      ORDER BY occurred_at DESC, event_id DESC
      LIMIT 1
    `).get(captureAttemptId) as { event_kind: CaptureEventKind } | undefined;
    if (!row) return "incomplete";
    if (row.event_kind === "body_completed") return "succeeded";
    if (row.event_kind === "capture_cancelled") return "cancelled";
    return "failed";
  }

  detectIncompleteAttempts(asOf: string): Array<{ captureAttemptId: string; failureReason: "process_crash_detected" }> {
    const rows = this.db.prepare(`
      SELECT capture_attempt_id
      FROM capture_attempts a
      WHERE request_started_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM capture_attempt_events e
          WHERE e.capture_attempt_id = a.capture_attempt_id
            AND e.event_kind IN ('body_completed', 'capture_failed', 'capture_cancelled')
        )
      ORDER BY capture_attempt_id
    `).all(canonicalUtcTimestamp(asOf)) as Array<{ capture_attempt_id: string }>;
    return rows.map((row) => ({
      captureAttemptId: row.capture_attempt_id,
      failureReason: "process_crash_detected",
    }));
  }

  recordRawDocument(input: RawWriteInput & {
    rawDocumentId?: string;
    contentEncoding?: string | null;
    retentionClass?: string;
  }): {
    rawDocumentId: string;
    rawSha256: string;
    deduplicated: boolean;
    relativePath: string;
  } {
    const write = this.rawStore.write(input);
    const existing = this.db.prepare(`
      SELECT raw_document_id FROM raw_documents WHERE raw_sha256 = ?
    `).get(write.rawSha256) as { raw_document_id: string } | undefined;
    if (existing) {
      return {
        rawDocumentId: existing.raw_document_id,
        rawSha256: write.rawSha256,
        deduplicated: true,
        relativePath: write.relativePath,
      };
    }
    const rawDocumentId = input.rawDocumentId ?? this.idFactory();
    const now = this.clock();
    this.db.prepare(`
      INSERT INTO raw_documents
      (raw_document_id, raw_sha256, entity_body_byte_length, content_type, charset,
       content_encoding, compressed_byte_length, decompression_ratio, integrity_status,
       storage_type, storage_path, first_recorded_at, retention_class,
       parser_replay_eligible, security_scan_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', 'content_addressed_filesystem',
              ?, ?, ?, 1, 'passed', ?)
    `).run(
      rawDocumentId,
      write.rawSha256,
      write.byteLength,
      input.contentType.split(";")[0].trim().toLowerCase(),
      input.charset ?? null,
      input.contentEncoding ?? null,
      input.compressedByteLength ?? null,
      write.decompressionRatio,
      write.relativePath,
      now,
      input.retentionClass ?? "research_evidence",
      now,
    );
    return {
      rawDocumentId,
      rawSha256: write.rawSha256,
      deduplicated: write.deduplicated,
      relativePath: write.relativePath,
    };
  }

  linkCaptureToRaw(input: {
    captureAttemptId: string;
    rawDocumentId: string;
    bodyCompletedEventId: string;
    linkedAt: string;
  }): void {
    const event = this.db.prepare(`
      SELECT e.capture_attempt_id, e.event_kind, e.occurred_at, e.byte_count,
             r.entity_body_byte_length
      FROM capture_attempt_events e
      JOIN raw_documents r ON r.raw_document_id = ?
      WHERE e.event_id = ?
    `).get(input.rawDocumentId, input.bodyCompletedEventId) as {
      capture_attempt_id: string;
      event_kind: string;
      occurred_at: string;
      byte_count: number | null;
      entity_body_byte_length: number;
    } | undefined;
    if (!event || event.capture_attempt_id !== input.captureAttemptId || event.event_kind !== "body_completed") {
      throw new Error("body completed event does not belong to capture");
    }
    if (event.byte_count === null || event.byte_count !== event.entity_body_byte_length) {
      throw new Error("body completed byte count does not match raw document");
    }
    const linkedAt = canonicalUtcTimestamp(input.linkedAt);
    if (Date.parse(linkedAt) < Date.parse(event.occurred_at)) {
      throw new Error("raw link precedes body completion");
    }
    this.db.prepare(`
      INSERT INTO capture_raw_links
      (capture_attempt_id, raw_document_id, body_completed_event_id, linked_at)
      VALUES (?, ?, ?, ?)
    `).run(
      input.captureAttemptId,
      input.rawDocumentId,
      input.bodyCompletedEventId,
      linkedAt,
    );
  }

  parseFixtureEnvelope(input: {
    parseRunId?: string;
    observationId?: string;
    rawDocumentId: string;
    parserName?: string;
    parserVersion: string;
    expectedSourceSchemaVersion?: string;
    supersedesParseRunId?: string | null;
    supersedesObservationId?: string | null;
    correctionKind?: string | null;
    correctionReason?: string | null;
  }): ParseResult {
    return this.parseTypedRawDocument({
      ...input,
      parserName: input.parserName ?? "research-replay-fixture-json",
      expectedSourceSchemaVersion: input.expectedSourceSchemaVersion ?? "fixture-envelope-v1",
      parse: (bytes) => JSON.parse(bytes.toString("utf8")) as FixtureEnvelope,
    });
  }

  parseTypedRawDocument(input: {
    parseRunId?: string;
    observationId?: string;
    rawDocumentId: string;
    parserName: string;
    parserVersion: string;
    expectedSourceSchemaVersion: string;
    parse: (bytes: Buffer) => FixtureEnvelope;
    supersedesParseRunId?: string | null;
    supersedesObservationId?: string | null;
    correctionKind?: string | null;
    correctionReason?: string | null;
  }): ParseResult {
    const raw = this.db.prepare(`
      SELECT raw_sha256, storage_path FROM raw_documents WHERE raw_document_id = ?
    `).get(input.rawDocumentId) as { raw_sha256: string; storage_path: string } | undefined;
    if (!raw) throw new Error("raw document missing");
    const bytes = this.rawStore.read(raw.storage_path, raw.raw_sha256);
    const parseRunId = input.parseRunId ?? this.idFactory();
    const startedAt = this.clock();
    let envelope: FixtureEnvelope | null = null;
    let status: ParseResult["status"] = "success";
    let errorCode: string | null = null;
    let semanticHash: string | null = null;
    let warningCodes: string[] = [];
    try {
      envelope = input.parse(bytes);
      if (envelope.sourceSchemaVersion !== input.expectedSourceSchemaVersion) {
        status = "unknown_schema";
        errorCode = "UNKNOWN_SOURCE_SCHEMA";
      } else {
        parseCanonicalRaceKey(envelope.canonicalRaceKey);
        validateTypedPayload(envelope.payloadType, envelope.payload);
        semanticHash = semanticPayloadHash(envelope.payloadType, envelope.payload);
        warningCodes = envelope.warningCodes ?? [];
        status = warningCodes.length > 0 ? "warning" : "success";
      }
    } catch {
      status = "error";
      errorCode = "PARSE_OR_VALIDATION_ERROR";
    }
    const completedAt = this.clock();
    this.db.prepare(`
      INSERT INTO parse_runs
      (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
       canonicalization_version, payload_type, status, warning_codes, error_code,
       started_at, completed_at, semantic_payload_hash, supersedes_id,
       correction_kind, correction_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parseRunId,
      input.rawDocumentId,
      input.parserName,
      input.parserVersion,
      envelope?.sourceSchemaVersion ?? "unreadable",
      CANONICALIZATION_VERSION,
      envelope?.payloadType ?? "unknown",
      status,
      safeJson(warningCodes),
      errorCode,
      startedAt,
      completedAt,
      semanticHash,
      input.supersedesParseRunId ?? null,
      input.correctionKind ?? null,
      input.correctionReason ?? null,
      completedAt,
    );

    if (!envelope || !semanticHash || (status !== "success" && status !== "warning")) {
      return { parseRunId, observationId: null, status, semanticPayloadHash: semanticHash, errorCode };
    }

    const observationId = input.observationId ?? this.idFactory();
    const recordedAt = this.clock();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO domain_observations
        (observation_id, canonical_race_key, observation_type, payload_type,
         payload_schema_version, parse_run_id, raw_document_id, source_published_at,
         source_observed_at, first_seen_at, timing_quality, source_quality,
         measurement_quality, semantic_payload_hash, supersedes_id, correction_kind,
         correction_reason, recorded_at, effective_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        observationId,
        envelope.canonicalRaceKey,
        envelope.payloadType,
        envelope.payloadType,
        PAYLOAD_SCHEMA_VERSION,
        parseRunId,
        input.rawDocumentId,
        envelope.sourcePublishedAt ? canonicalUtcTimestamp(envelope.sourcePublishedAt) : null,
        canonicalUtcTimestamp(envelope.sourceObservedAt),
        canonicalUtcTimestamp(envelope.firstSeenAt),
        envelope.timingQuality,
        envelope.sourceQuality,
        envelope.measurementQuality,
        semanticHash,
        input.supersedesObservationId ?? null,
        input.correctionKind ?? null,
        input.correctionReason ?? null,
        recordedAt,
        envelope.effectiveAt ? canonicalUtcTimestamp(envelope.effectiveAt) : null,
        recordedAt,
      );
      this.db.prepare(`
        INSERT INTO typed_observation_payloads
        (observation_id, payload_type, payload_schema_version, payload_json, payload_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        observationId,
        envelope.payloadType,
        PAYLOAD_SCHEMA_VERSION,
        JSON.stringify(envelope.payload),
        semanticHash,
        recordedAt,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { parseRunId, observationId, status, semanticPayloadHash: semanticHash, errorCode };
  }

  loadTypedPayload(observationId: string): { type: ObservationType; payload: unknown } {
    const row = this.db.prepare(`
      SELECT payload_type, payload_schema_version, payload_json, payload_hash
      FROM typed_observation_payloads WHERE observation_id = ?
    `).get(observationId) as {
      payload_type: ObservationType;
      payload_schema_version: string;
      payload_json: string;
      payload_hash: string;
    } | undefined;
    if (!row) throw new Error("PAYLOAD_REFERENCE_MISSING");
    if (row.payload_schema_version !== PAYLOAD_SCHEMA_VERSION) throw new Error("PAYLOAD_SCHEMA_UNKNOWN");
    const payload = JSON.parse(row.payload_json) as unknown;
    validateTypedPayload(row.payload_type, payload);
    if (semanticPayloadHash(row.payload_type, payload) !== row.payload_hash) throw new Error("payload hash mismatch");
    return { type: row.payload_type, payload };
  }

  auditRawCache(): {
    rawDocumentCount: number;
    captureAttemptCount: number;
    captureEventCount: number;
    parseRunCount: number;
    observationCount: number;
    linkedCaptureCount: number;
    dedupRatio: number;
    orphanMetadataCount: number;
    orphanBodyCount: number;
    integrityErrorCount: number;
    pinnedCount: number;
    unreferencedCount: number;
    storageBytes: number;
  } {
    const scalar = (sql: string): number => Number((this.db.prepare(sql).get() as { count: number }).count);
    const rawRows = this.db.prepare(`
      SELECT r.raw_document_id, r.raw_sha256, r.storage_path, r.entity_body_byte_length,
             EXISTS (
               SELECT 1 FROM evidence_tombstones t
               WHERE t.evidence_type='raw_document' AND t.evidence_id=r.raw_document_id
             ) AS tombstoned
      FROM raw_documents r
    `).all() as Array<{
      raw_document_id: string;
      raw_sha256: string;
      storage_path: string;
      entity_body_byte_length: number;
      tombstoned: number;
    }>;
    let orphanMetadataCount = 0;
    let integrityErrorCount = 0;
    let storageBytes = 0;
    const knownPaths = new Set<string>();
    for (const row of rawRows) {
      if (row.tombstoned) continue;
      knownPaths.add(row.storage_path);
      storageBytes += row.entity_body_byte_length;
      if (!this.rawStore.integrity(row.storage_path, row.raw_sha256, row.entity_body_byte_length)) {
        orphanMetadataCount += 1;
        integrityErrorCount += 1;
      }
    }
    const diskPaths: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /^[a-f0-9]{64}$/.test(entry.name)) {
          diskPaths.push(full.slice(this.rawStore.root.length + 1));
        }
      }
    };
    walk(this.rawStore.root);
    const orphanBodyCount = diskPaths.filter((path) => !knownPaths.has(path)).length;
    const captureAttemptCount = scalar("SELECT COUNT(*) count FROM capture_attempts");
    const linkedCaptureCount = scalar("SELECT COUNT(*) count FROM capture_raw_links");
    const pinnedCount = scalar("SELECT COUNT(*) count FROM evidence_pins");
    const unreferencedCount = scalar(`
      SELECT COUNT(*) count FROM raw_documents r
      WHERE NOT EXISTS (
        SELECT 1 FROM evidence_pins p
        WHERE p.evidence_type='raw_document' AND p.evidence_id=r.raw_document_id
      )
    `);
    return {
      rawDocumentCount: rawRows.length,
      captureAttemptCount,
      captureEventCount: scalar("SELECT COUNT(*) count FROM capture_attempt_events"),
      parseRunCount: scalar("SELECT COUNT(*) count FROM parse_runs"),
      observationCount: scalar("SELECT COUNT(*) count FROM domain_observations"),
      linkedCaptureCount,
      dedupRatio: rawRows.length === 0 ? 0 : linkedCaptureCount / rawRows.length,
      orphanMetadataCount,
      orphanBodyCount,
      integrityErrorCount,
      pinnedCount,
      unreferencedCount,
      storageBytes,
    };
  }

  gcDryRun(): Array<{ rawDocumentId: string; action: "retain_pinned" | "eligible_unreferenced" }> {
    const rows = this.db.prepare(`
      SELECT r.raw_document_id,
             EXISTS (
               SELECT 1 FROM evidence_pins p
               WHERE p.evidence_type='raw_document' AND p.evidence_id=r.raw_document_id
             ) AS pinned
      FROM raw_documents r ORDER BY r.raw_document_id
    `).all() as Array<{ raw_document_id: string; pinned: number }>;
    return rows.map((row) => ({
      rawDocumentId: row.raw_document_id,
      action: row.pinned ? "retain_pinned" : "eligible_unreferenced",
    }));
  }

  recordTombstone(input: {
    tombstoneId?: string;
    evidenceType: string;
    evidenceId: string;
    reason: string;
    recordedAt: string;
  }): string {
    const id = input.tombstoneId ?? this.idFactory();
    this.db.prepare(`
      INSERT INTO evidence_tombstones
      (tombstone_id, evidence_type, evidence_id, reason, recorded_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.evidenceType,
      input.evidenceId,
      input.reason,
      canonicalUtcTimestamp(input.recordedAt),
      this.clock(),
    );
    return id;
  }

  lineageForObservation(observationId: string): {
    observationId: string;
    parseRunId: string;
    rawDocumentId: string;
    captureAttemptIds: string[];
  } {
    const row = this.db.prepare(`
      SELECT parse_run_id, raw_document_id FROM domain_observations WHERE observation_id = ?
    `).get(observationId) as { parse_run_id: string; raw_document_id: string } | undefined;
    if (!row) throw new Error("observation missing");
    const captures = this.db.prepare(`
      SELECT capture_attempt_id FROM capture_raw_links WHERE raw_document_id = ? ORDER BY capture_attempt_id
    `).all(row.raw_document_id) as Array<{ capture_attempt_id: string }>;
    return {
      observationId,
      parseRunId: row.parse_run_id,
      rawDocumentId: row.raw_document_id,
      captureAttemptIds: captures.map((capture) => capture.capture_attempt_id),
    };
  }

  semanticFingerprint(observationIds: string[]): string {
    const rows = observationIds.map((id) => this.db.prepare(`
      SELECT observation_id, observation_type, semantic_payload_hash
      FROM domain_observations WHERE observation_id=?
    `).get(id));
    return canonicalHash(rows);
  }
}
