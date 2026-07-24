import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CANONICALIZATION_VERSION,
  canonicalHash,
  canonicalSerialize,
  canonicalUtcTimestamp,
  missing,
  unordered,
} from "./canonical";
import {
  compareGolden,
  FIXTURE_AS_OF,
  FIXTURE_DIR,
  FIXTURE_RACE_KEY,
  runResearchReplayCanary,
} from "./canary";
import {
  CHECKPOINT_POLICY_VERSION,
  classifyRawSemanticChange,
  freezeCheckpoint,
  semanticPayloadHash,
  validateTypedPayload,
} from "./domain";
import { canonicalRaceKey, canonicalTrifectaSelection, parseCanonicalRaceKey } from "./identity";
import {
  buildRaceAsOfManifest,
  RESOLUTION_POLICIES,
  strictPitGuard,
} from "./manifest";
import {
  allowlistedHeaders,
  contentAddressedRelativePath,
  RAW_SECURITY_LIMITS,
  RawStore,
  redactSourceUrl,
} from "./rawStore";
import { ResearchReplayRepository, type FixtureEnvelope } from "./repository";
import {
  F0_MIGRATION_CHECKSUM,
  initializeSidecarSchema,
  openSidecarDatabase,
  SIDECAR_SCHEMA_VERSION,
  verifySidecarSchema,
} from "./schema";

type Context = {
  root: string;
  db: DatabaseSync;
  rawStore: RawStore;
  repository: ResearchReplayRepository;
  close(): void;
};

function context(): Context {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0-test-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, "2026-07-24T00:00:00.000Z");
  const rawStore = new RawStore(join(root, "raw"));
  let id = 0;
  const repository = new ResearchReplayRepository(
    db,
    rawStore,
    () => `test-${++id}`,
    () => "2026-07-24T00:00:00.000Z",
  );
  return {
    root,
    db,
    rawStore,
    repository,
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function scheduleEnvelope(overrides: Partial<FixtureEnvelope> = {}): FixtureEnvelope {
  return {
    sourceSchemaVersion: "fixture-envelope-v1",
    payloadType: "race_schedule",
    canonicalRaceKey: FIXTURE_RACE_KEY,
    payload: {
      canonicalRaceKey: FIXTURE_RACE_KEY,
      scheduledCloseAt: "2026-07-24T06:20:00.000Z",
      scheduledCloseOriginalOffset: "+09:00",
      scheduleStatus: "scheduled",
    },
    sourcePublishedAt: "2026-07-24T05:00:00.000Z",
    sourceObservedAt: "2026-07-24T05:00:01.000Z",
    firstSeenAt: "2026-07-24T05:00:01.000Z",
    timingQuality: "source_exact",
    sourceQuality: "sanitized_fixture",
    measurementQuality: "exact",
    effectiveAt: "2026-07-24T05:00:00.000Z",
    ...overrides,
  };
}

function fixtureEnvelope(name: string): FixtureEnvelope {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as FixtureEnvelope;
}

function recordEnvelope(
  ctx: Context,
  envelope: unknown,
  parserVersion = "rr-parser-test-v1",
  options: {
    rawDocumentId?: string;
    parseRunId?: string;
    observationId?: string;
    expectedSourceSchemaVersion?: string;
    supersedesParseRunId?: string;
    supersedesObservationId?: string;
  } = {},
) {
  const raw = ctx.repository.recordRawDocument({
    rawDocumentId: options.rawDocumentId,
    bytes: Buffer.from(JSON.stringify(envelope), "utf8"),
    contentType: "application/json",
    charset: "utf-8",
  });
  const parsed = ctx.repository.parseFixtureEnvelope({
    rawDocumentId: raw.rawDocumentId,
    parserVersion,
    parseRunId: options.parseRunId,
    observationId: options.observationId,
    expectedSourceSchemaVersion: options.expectedSourceSchemaVersion,
    supersedesParseRunId: options.supersedesParseRunId,
    supersedesObservationId: options.supersedesObservationId,
    correctionKind: options.supersedesObservationId ? "test_correction" : null,
    correctionReason: options.supersedesObservationId ? "test" : null,
  });
  return { raw, parsed };
}

test("canonical serializationはobject key orderとlocaleに依存しない", () => {
  assert.equal(canonicalSerialize({ b: 2, a: 1 }), canonicalSerialize({ a: 1, b: 2 }));
  assert.equal(canonicalHash({ z: true, a: "x" }), canonicalHash({ a: "x", z: true }));
});

test("canonical serializationはUnicodeをNFCへ正規化する", () => {
  assert.equal(canonicalHash("ボート"), canonicalHash("ボート"));
});

test("canonical serializationはorderedとunordered arrayを区別する", () => {
  assert.notEqual(canonicalHash(["a", "b"]), canonicalHash(["b", "a"]));
  assert.equal(canonicalHash(unordered(["a", "b"])), canonicalHash(unordered(["b", "a"])));
});

test("canonical serializationはNULLとmissingを区別する", () => {
  assert.notEqual(canonicalHash({ value: null }), canonicalHash({ value: missing() }));
  assert.equal(canonicalSerialize(undefined), canonicalSerialize(missing()));
});

test("canonical serializationは-0/0を統一しfloatを固定する", () => {
  assert.equal(canonicalHash(-0), canonicalHash(0));
  assert.notEqual(canonicalHash(1), canonicalHash(1.25));
});

test("timestampはUTC millisecondへ正規化する", () => {
  assert.equal(canonicalUtcTimestamp("2026-07-25T00:00:00+09:00"), "2026-07-24T15:00:00.000Z");
  assert.throws(() => canonicalUtcTimestamp("unknown"));
});

test("canonical race identityをJST日付・場code・race noで固定する", () => {
  const key = canonicalRaceKey("2026-07-24", "01", 12);
  assert.equal(key, "2026-07-24:01:R12");
  assert.deepEqual(parseCanonicalRaceKey(key), {
    raceDateJst: "2026-07-24",
    venueCode: "01",
    raceNo: 12,
    canonicalRaceKey: key,
  });
  assert.throws(() => canonicalRaceKey("2026-07-24", "25", 1));
});

test("3連単selectionは順序付き・重複艇なしでcanonical化する", () => {
  assert.equal(canonicalTrifectaSelection("1-2-3"), "1-2-3");
  assert.throws(() => canonicalTrifectaSelection("1-1-2"));
  assert.throws(() => canonicalTrifectaSelection("1-2"));
});

test("sidecar clean migrationとrerunは決定的", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const first = verifySidecarSchema(ctx.db);
  initializeSidecarSchema(ctx.db);
  const second = verifySidecarSchema(ctx.db);
  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, SIDECAR_SCHEMA_VERSION);
  assert.equal(first.migrationChecksum, F0_MIGRATION_CHECKSUM);
});

test("sidecar migration checksum不一致をdefault denyする", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  ctx.db.prepare("UPDATE research_schema_migrations SET checksum='bad'").run();
  assert.equal(verifySidecarSchema(ctx.db).ok, false);
  assert.throws(() => initializeSidecarSchema(ctx.db), /refused/);
});

test("sidecar partial migrationとunknown versionを検知する", (t) => {
  const partial = context();
  t.after(() => partial.close());
  partial.db.prepare("UPDATE research_schema_migrations SET status='partial'").run();
  assert.equal(verifySidecarSchema(partial.db).partialMigration, true);
  const unknown = context();
  t.after(() => unknown.close());
  unknown.db.exec("PRAGMA user_version=999");
  assert.equal(verifySidecarSchema(unknown.db).unknownSchema, true);
});

test("capture attemptはimmutableでeventsはappend-only", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const attempt = ctx.repository.createCaptureAttempt({
    logicalRequestGroupId: "group-1",
    canonicalRaceKey: FIXTURE_RACE_KEY,
    sourceUrl: "https://fixture.invalid/source",
    method: "LOCAL_FIXTURE",
    requestStartedAt: "2026-07-24T00:00:00Z",
    sourceType: "sanitized_fixture",
  });
  ctx.repository.addCaptureEvent({
    captureAttemptId: attempt,
    eventKind: "capture_started",
    occurredAt: "2026-07-24T00:00:00Z",
  });
  assert.throws(() => ctx.db.prepare("UPDATE capture_attempts SET source_type='x'").run(), /append-only/);
  assert.throws(() => ctx.db.prepare("DELETE FROM capture_attempt_events").run(), /append-only/);
});

test("capture lifecycleはsuccess/failure/incompleteを区別しterminal後を拒否する", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const make = (group: string) => ctx.repository.createCaptureAttempt({
    logicalRequestGroupId: group,
    sourceUrl: `https://fixture.invalid/${group}`,
    method: "LOCAL_FIXTURE",
    requestStartedAt: "2026-07-24T00:00:00Z",
    sourceType: "sanitized_fixture",
  });
  const success = make("success");
  ctx.repository.addCaptureEvent({ captureAttemptId: success, eventKind: "capture_started", occurredAt: "2026-07-24T00:00:00Z" });
  ctx.repository.addCaptureEvent({ captureAttemptId: success, eventKind: "body_completed", occurredAt: "2026-07-24T00:00:01Z", byteCount: 0 });
  assert.equal(ctx.repository.captureState(success), "succeeded");
  assert.throws(() => ctx.repository.addCaptureEvent({
    captureAttemptId: success,
    eventKind: "capture_failed",
    occurredAt: "2026-07-24T00:00:02Z",
    failureReason: "timeout",
  }), /terminal/);
  const failure = make("failure");
  ctx.repository.addCaptureEvent({ captureAttemptId: failure, eventKind: "capture_failed", occurredAt: "2026-07-24T00:00:01Z", failureReason: "partial_body" });
  assert.equal(ctx.repository.captureState(failure), "failed");
  const incomplete = make("incomplete");
  assert.equal(ctx.repository.captureState(incomplete), "incomplete");
  assert.equal(ctx.repository.detectIncompleteAttempts("2026-07-24T00:00:01Z").some((row) => row.captureAttemptId === incomplete), true);
});

test("retryは別attempt IDと同じlogical groupを持つ", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const input = {
    logicalRequestGroupId: "retry-group",
    sourceUrl: "https://fixture.invalid/retry",
    method: "LOCAL_FIXTURE" as const,
    requestStartedAt: "2026-07-24T00:00:00Z",
    sourceType: "sanitized_fixture",
  };
  const first = ctx.repository.createCaptureAttempt(input);
  const second = ctx.repository.createCaptureAttempt(input);
  assert.notEqual(first, second);
  const count = ctx.db.prepare("SELECT COUNT(*) count FROM capture_attempts WHERE logical_request_group_id='retry-group'").get() as { count: number };
  assert.equal(count.count, 2);
});

test("source aliasはcanonical race keyへappend-onlyで対応付ける", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const alias = ctx.repository.addRaceIdentityAlias({
    canonicalRaceKey: FIXTURE_RACE_KEY,
    sourceType: "fixture",
    sourceRaceId: "source-race-1",
    sourceUrl: "https://fixture.invalid/race?token=secret",
    observedAt: "2026-07-24T00:00:00Z",
  });
  const row = ctx.db.prepare("SELECT canonical_race_key,source_url_redacted FROM race_identity_aliases WHERE alias_id=?").get(alias) as {
    canonical_race_key: string;
    source_url_redacted: string;
  };
  assert.equal(row.canonical_race_key, FIXTURE_RACE_KEY);
  assert.equal(row.source_url_redacted.includes("secret"), false);
  assert.throws(() => ctx.db.prepare("UPDATE race_identity_aliases SET source_race_id='changed'").run(), /append-only/);
});

test("raw storeはsame bodyをdedupしcapture historyを失わない", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const bytes = Buffer.from("same");
  const first = ctx.repository.recordRawDocument({ bytes, contentType: "text/plain", charset: "utf-8" });
  const second = ctx.repository.recordRawDocument({ bytes, contentType: "text/plain", charset: "utf-8" });
  assert.equal(first.rawDocumentId, second.rawDocumentId);
  assert.equal(second.deduplicated, true);
  assert.equal(ctx.repository.auditRawCache().rawDocumentCount, 1);
});

test("raw storeは異なるbody・empty bodyを別hashで保存する", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const empty = ctx.repository.recordRawDocument({ bytes: Buffer.alloc(0), contentType: "text/plain", charset: "utf-8" });
  const other = ctx.repository.recordRawDocument({ bytes: Buffer.from("x"), contentType: "text/plain", charset: "utf-8" });
  assert.notEqual(empty.rawSha256, other.rawSha256);
  assert.equal(ctx.rawStore.integrity(empty.relativePath, empty.rawSha256, 0), true);
});

test("raw securityはcontent type/charset/body/decompression limitを拒否する", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  assert.throws(() => ctx.rawStore.write({ bytes: Buffer.from("x"), contentType: "application/octet-stream" }), /unsupported/);
  assert.throws(() => ctx.rawStore.write({ bytes: Buffer.from("x"), contentType: "text/plain", charset: "unknown" }), /unknown_charset/);
  assert.throws(() => ctx.rawStore.write({
    bytes: Buffer.alloc(RAW_SECURITY_LIMITS.maxEntityBodyBytes + 1),
    contentType: "text/plain",
  }), /body_too_large/);
  assert.throws(() => ctx.rawStore.write({
    bytes: Buffer.from("x"),
    contentType: "text/plain",
    compressedByteLength: 1,
    decompressedByteLength: RAW_SECURITY_LIMITS.maxDecompressedBytes + 1,
  }), /decompression_limit/);
});

test("raw pathはhashだけから決まりtraversalを拒否する", () => {
  assert.match(contentAddressedRelativePath("a".repeat(64)), /^sha256/);
  assert.throws(() => contentAddressedRelativePath("../../secret"));
});

test("raw storeはsymlink rootを拒否する", (t) => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0-symlink-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, "target");
  mkdirSync(target);
  const link = join(root, "link");
  symlinkSync(target, link);
  assert.throws(() => new RawStore(link), /symlink/);
});

test("raw integrity監査はorphan metadataとorphan bodyを検知する", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const raw = ctx.repository.recordRawDocument({ bytes: Buffer.from("tracked"), contentType: "text/plain", charset: "utf-8" });
  unlinkSync(ctx.rawStore.absolutePathForHash(raw.rawSha256));
  const orphanHash = "b".repeat(64);
  const orphanPath = ctx.rawStore.absolutePathForHash(orphanHash);
  mkdirSync(dirname(orphanPath), { recursive: true });
  writeFileSync(orphanPath, "orphan");
  const audit = ctx.repository.auditRawCache();
  assert.equal(audit.orphanMetadataCount, 1);
  assert.equal(audit.orphanBodyCount, 1);
  assert.equal(audit.integrityErrorCount, 1);
});

test("header allowlistとURL redactionはsecretを保存しない", () => {
  const headers = allowlistedHeaders({
    "content-type": "text/html",
    authorization: "secret",
    cookie: "secret",
    "set-cookie": "secret",
  });
  assert.deepEqual(headers, { "content-type": "text/html" });
  const redacted = redactSourceUrl("https://example.invalid/path?token=secret&race=1");
  assert.equal(redacted.includes("secret"), false);
  assert.equal(redacted.includes("race=1"), true);
});

test("typed payloadはunknown fieldと不正selectionを拒否する", () => {
  const valid = scheduleEnvelope().payload;
  assert.doesNotThrow(() => validateTypedPayload("race_schedule", valid));
  assert.throws(() => validateTypedPayload("race_schedule", { ...(valid as object), extra: true }));
  assert.throws(() => validateTypedPayload("race_result", {
    trifecta: "1-1-2",
    finishPositions: [1, 2, 3],
    confirmedAt: "2026-07-24T07:00:00Z",
  }));
});

test("same raw/same parserのsemantic hashは決定的", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const first = recordEnvelope(ctx, scheduleEnvelope(), "rr-parser-test-v1");
  const second = ctx.repository.parseFixtureEnvelope({
    rawDocumentId: first.raw.rawDocumentId,
    parserVersion: "rr-parser-test-v1",
  });
  assert.equal(first.parsed.semanticPayloadHash, second.semanticPayloadHash);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) count FROM parse_runs").get() as { count: number }).count, 2);
});

test("new parser reparseは新run/observationを作り旧runを保持する", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const first = recordEnvelope(ctx, scheduleEnvelope(), "rr-parser-test-v1", {
    parseRunId: "parse-old",
    observationId: "obs-old",
  });
  const second = ctx.repository.parseFixtureEnvelope({
    rawDocumentId: first.raw.rawDocumentId,
    parserVersion: "rr-parser-test-v2",
    parseRunId: "parse-new",
    observationId: "obs-new",
    supersedesParseRunId: "parse-old",
    supersedesObservationId: "obs-old",
    correctionKind: "parser_upgrade",
    correctionReason: "test",
  });
  assert.equal(second.observationId, "obs-new");
  assert.equal((ctx.db.prepare("SELECT COUNT(*) count FROM parse_runs").get() as { count: number }).count, 2);
  assert.equal((ctx.db.prepare("SELECT supersedes_id FROM domain_observations WHERE observation_id='obs-new'").get() as { supersedes_id: string }).supersedes_id, "obs-old");
  assert.throws(() => ctx.db.prepare("UPDATE domain_observations SET correction_reason='bad' WHERE observation_id='obs-old'").run(), /append-only/);
});

test("parser warning/error/unknown schemaを別statusで保持する", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const warning = recordEnvelope(ctx, scheduleEnvelope({ warningCodes: ["COSMETIC"] }));
  assert.equal(warning.parsed.status, "warning");
  const invalidRaw = ctx.repository.recordRawDocument({
    bytes: Buffer.from("{broken", "utf8"),
    contentType: "application/json",
    charset: "utf-8",
  });
  const invalid = ctx.repository.parseFixtureEnvelope({
    rawDocumentId: invalidRaw.rawDocumentId,
    parserVersion: "rr-parser-test-v1",
  });
  assert.equal(invalid.status, "error");
  const unknown = recordEnvelope(ctx, scheduleEnvelope({ sourceSchemaVersion: "fixture-envelope-v2" }));
  assert.equal(unknown.parsed.status, "unknown_schema");
  assert.equal(unknown.parsed.observationId, null);
});

test("raw/semantic change classifierは7分類を分離する", () => {
  const cases = [
    classifyRawSemanticChange({ rawChanged: false, semanticChanged: false, parserStatus: "healthy", sourceSchemaStatus: "known" }),
    classifyRawSemanticChange({ rawChanged: true, semanticChanged: true, parserStatus: "healthy", sourceSchemaStatus: "known" }),
    classifyRawSemanticChange({ rawChanged: true, semanticChanged: false, parserStatus: "healthy", sourceSchemaStatus: "known" }),
    classifyRawSemanticChange({ rawChanged: true, semanticChanged: false, parserStatus: "warning", sourceSchemaStatus: "known" }),
    classifyRawSemanticChange({ rawChanged: true, parserStatus: "error", sourceSchemaStatus: "known" }),
    classifyRawSemanticChange({ rawChanged: true, parserStatus: "healthy", sourceSchemaStatus: "unknown" }),
    classifyRawSemanticChange({ rawChanged: false, semanticChanged: true, parserStatus: "healthy", sourceSchemaStatus: "known" }),
  ];
  assert.equal(new Set(cases.map((item) => item.classification)).size, 7);
  assert.equal(cases[6].sourceEvent, false);
});

test("checkpointはcapture時の締切versionで凍結される", () => {
  const first = freezeCheckpoint("2026-07-24T06:20:00Z", "2026-07-24T06:15:00Z");
  const changed = freezeCheckpoint("2026-07-24T06:23:00Z", "2026-07-24T06:18:00Z");
  assert.equal(first.checkpointLabelAtCapture, "T-5");
  assert.equal(first.scheduledCloseAtSeen, "2026-07-24T06:20:00.000Z");
  assert.equal(changed.scheduledCloseAtSeen, "2026-07-24T06:23:00.000Z");
  assert.equal(first.checkpointPolicyVersion, CHECKPOINT_POLICY_VERSION);
});

test("E2E canaryは五層・dedup・manifest・supersessionを通過する", () => {
  const report = runResearchReplayCanary();
  assert.equal(report.status, "CONDITIONAL");
  assert.equal(report.dedupResult.sameBodyDeduplicated, true);
  assert.equal(report.manifestResult.firstManifestUnchanged, true);
  assert.equal(report.manifestResult.checkpointFrozen, true);
  assert.equal(Object.values(report.appendOnlyChecks).every(Boolean), true);
  assert.equal(report.rawCounts.integrityErrorCount, 0);
});

test("PIT sentinelはfuture/result/current/closing/fixtureを拒否する", () => {
  const report = runResearchReplayCanary();
  assert.ok(report.pitRejectionMatrix["obs-result-v1"].includes("POST_RACE_OBSERVATION"));
  assert.ok(report.pitRejectionMatrix["obs-result-v1"].includes("SOURCE_PUBLISHED_AFTER_AS_OF"));
  assert.ok(report.pitRejectionMatrix["obs-current-profile-v1"].includes("CURRENT_PROFILE_USED_FOR_PAST_RACE"));
  assert.ok(report.pitRejectionMatrix["obs-historical-closing-v1"].includes("HISTORICAL_CLOSING_USED_AS_LIVE"));
  assert.ok(report.pitRejectionMatrix["obs-fixture-only-v1"].includes("FIXTURE_USED_AS_LIVE"));
});

test("同一millisecond境界はfuture扱いしない", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const recorded = recordEnvelope(ctx, scheduleEnvelope({
    sourcePublishedAt: FIXTURE_AS_OF,
    sourceObservedAt: FIXTURE_AS_OF,
    firstSeenAt: FIXTURE_AS_OF,
  }), "rr-parser-test-v1", { observationId: "obs-boundary" });
  const row = ctx.db.prepare(`
    SELECT o.*, p.parser_version, p.status parse_status
    FROM domain_observations o JOIN parse_runs p ON p.parse_run_id=o.parse_run_id
    WHERE o.observation_id=?
  `).get(recorded.parsed.observationId) as never;
  const guard = strictPitGuard({
    observation: row,
    repository: ctx.repository,
    canonicalRaceKey: FIXTURE_RACE_KEY,
    asOfAt: FIXTURE_AS_OF,
    policy: RESOLUTION_POLICIES.research_replay_strict_pre_race,
  });
  assert.equal(guard.codes.includes("OBSERVATION_AFTER_AS_OF"), false);
});

test("PIT guardはrace mismatch・timing ambiguous・unknown typeをdefault denyする", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const base = {
    observation_id: "missing-payload",
    canonical_race_key: FIXTURE_RACE_KEY,
    observation_type: "unknown_future_type",
    payload_schema_version: "rr-payload-v1",
    parse_run_id: "parse",
    raw_document_id: "raw",
    source_published_at: null,
    source_observed_at: FIXTURE_AS_OF,
    first_seen_at: FIXTURE_AS_OF,
    timing_quality: "ambiguous" as const,
    source_quality: "sanitized_fixture" as const,
    semantic_payload_hash: "x",
    parser_version: "rr-parser-test-v1",
    parse_status: "success",
  };
  const guard = strictPitGuard({
    observation: base,
    repository: ctx.repository,
    canonicalRaceKey: "2026-07-24:02:R1",
    asOfAt: FIXTURE_AS_OF,
    policy: RESOLUTION_POLICIES.research_replay_strict_pre_race,
  });
  assert.equal(guard.disposition, "quarantined");
  assert.ok(guard.codes.includes("UNKNOWN_OBSERVATION_TYPE"));
  assert.ok(guard.codes.includes("TIMING_AMBIGUOUS"));
  assert.ok(guard.codes.includes("CANONICAL_RACE_MISMATCH"));
});

test("manifestはrequired missingをblockedにし暗黙補完しない", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  recordEnvelope(ctx, scheduleEnvelope(), "rr-parser-test-v1", { observationId: "obs-schedule" });
  const manifest = buildRaceAsOfManifest({
    db: ctx.db,
    repository: ctx.repository,
    canonicalRaceKey: FIXTURE_RACE_KEY,
    asOfAt: FIXTURE_AS_OF,
    purpose: "research_replay_strict_pre_race",
    gitCommitSha: "test",
    sourceSnapshotId: "test",
    persist: false,
  });
  assert.equal(manifest.status, "blocked");
  assert.equal(manifest.expectations.filter((item) => item.completenessState === "missing").length, 2);
});

test("manifestはstale required inputを明示する", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  recordEnvelope(ctx, scheduleEnvelope({
    sourcePublishedAt: "2026-07-20T00:00:00Z",
    sourceObservedAt: "2026-07-20T00:00:00Z",
    firstSeenAt: "2026-07-20T00:00:00Z",
  }), "rr-parser-test-v1", { observationId: "obs-stale-schedule" });
  const manifest = buildRaceAsOfManifest({
    db: ctx.db,
    repository: ctx.repository,
    canonicalRaceKey: FIXTURE_RACE_KEY,
    asOfAt: FIXTURE_AS_OF,
    purpose: "research_replay_strict_pre_race",
    gitCommitSha: "test",
    sourceSnapshotId: "test",
    persist: false,
  });
  const schedule = manifest.expectations.find((item) => item.expectedObservationType === "race_schedule");
  assert.equal(schedule?.completenessState, "stale");
  assert.equal(schedule?.rejectionCode, "STALE_REQUIRED_INPUT");
});

test("manifest selectionはsource priorityをobserved timeより優先する", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  recordEnvelope(ctx, scheduleEnvelope({
    sourceQuality: "sanitized_fixture",
    sourceObservedAt: "2026-07-24T05:10:00Z",
    firstSeenAt: "2026-07-24T05:10:00Z",
  }), "rr-parser-test-v1", { observationId: "obs-schedule-fixture" });
  recordEnvelope(ctx, scheduleEnvelope({
    sourceQuality: "official_public",
    sourceObservedAt: "2026-07-24T05:00:01Z",
    firstSeenAt: "2026-07-24T05:00:01Z",
  }), "rr-parser-test-v1", { observationId: "obs-schedule-official" });
  recordEnvelope(ctx, fixtureEnvelope("trifecta-market.json"), "rr-parser-test-v1", { observationId: "obs-market" });
  recordEnvelope(ctx, fixtureEnvelope("beforeinfo.json"), "rr-parser-test-v1", { observationId: "obs-beforeinfo" });
  const manifest = buildRaceAsOfManifest({
    db: ctx.db,
    repository: ctx.repository,
    canonicalRaceKey: FIXTURE_RACE_KEY,
    asOfAt: FIXTURE_AS_OF,
    purpose: "research_replay_strict_pre_race",
    gitCommitSha: "test",
    sourceSnapshotId: "test",
    persist: false,
  });
  assert.equal(
    manifest.expectations.find((item) => item.expectedObservationType === "race_schedule")?.selectedObservationId,
    "obs-schedule-official",
  );
});

test("manifest hashはpolicy/canonicalization version差を識別する", () => {
  const report = runResearchReplayCanary();
  assert.notEqual(report.manifestResult.firstManifestHash, report.manifestResult.secondManifestHash);
  assert.notEqual(canonicalHash({ version: CANONICALIZATION_VERSION }), canonicalHash({ version: "rr-c14n-v2" }));
});

test("manifest pinはGC dry-runで保持されRESTRICT/append-onlyで削除不可", () => {
  const report = runResearchReplayCanary();
  assert.equal(report.securityChecks.referencedEvidenceRetainedByGcDryRun, true);
  assert.equal(report.appendOnlyChecks.referencedEvidenceDeleteRejected, true);
  assert.ok(report.rawCounts.pinnedCount > 0);
});

test("tombstoneはappend-only契約で証拠rowを削除しない", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const id = ctx.repository.recordTombstone({
    evidenceType: "raw_document",
    evidenceId: "missing-evidence",
    reason: "contract test",
    recordedAt: FIXTURE_AS_OF,
  });
  assert.ok(ctx.db.prepare("SELECT 1 FROM evidence_tombstones WHERE tombstone_id=?").get(id));
  assert.throws(() => ctx.db.prepare("DELETE FROM evidence_tombstones WHERE tombstone_id=?").run(id), /append-only/);
});

test("golden fixtureはexpected raw/semantic/manifest hashと一致する", () => {
  const report = runResearchReplayCanary();
  const golden = compareGolden(report);
  assert.deepEqual(golden.mismatches, []);
  assert.equal(golden.ok, true);
});

test("fixture bundleはtimezone/float/range/NULL/Unicode/array orderを持つ", () => {
  const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, "canonical-edge-cases.json"), "utf8")) as Record<string, unknown>;
  for (const key of ["timezone", "float", "range", "nullable", "unicode", "orderedArray", "unorderedArray"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(fixture, key), true);
  }
});

test("read-only source DBはwriteを拒否しschemaを変えない", (t) => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0-readonly-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "source.sqlite");
  const writer = new DatabaseSync(path);
  writer.exec("CREATE TABLE source_fact(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO source_fact(value) VALUES ('x');");
  writer.close();
  chmodSync(path, 0o444);
  const reader = new DatabaseSync(path, { readOnly: true });
  assert.equal((reader.prepare("SELECT COUNT(*) count FROM source_fact").get() as { count: number }).count, 1);
  assert.throws(() => reader.exec("CREATE TABLE forbidden(id INTEGER)"));
  reader.close();
});

test("schema migrationはproduction table名やapp_settingsを含まない", () => {
  assert.equal(F0_MIGRATION_CHECKSUM.length, 64);
  assert.equal(SIDECAR_SCHEMA_VERSION, "f0.1.0");
  const report = runResearchReplayCanary();
  assert.equal(report.nonRegression.productionDbWritten, false);
  assert.equal(report.nonRegression.predictionLogicChanged, false);
  assert.equal(report.nonRegression.legacyEvaluationMixed, false);
});
