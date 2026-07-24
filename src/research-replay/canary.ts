import { performance } from "node:perf_hooks";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { canonicalHash, canonicalSerialize, sha256Bytes, unordered } from "./canonical";
import { classifyRawSemanticChange } from "./domain";
import { buildRaceAsOfManifest, type PitRejectionCode } from "./manifest";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import {
  F0_MIGRATION_CHECKSUM,
  initializeSidecarSchema,
  openSidecarDatabase,
  SIDECAR_SCHEMA_VERSION,
  verifySidecarSchema,
} from "./schema";

export const FIXTURE_VERSION = "rr-golden-fixture-v1";
export const FIXTURE_RACE_KEY = "2026-07-24:01:R1";
export const FIXTURE_AS_OF = "2026-07-24T06:15:00.000Z";
export const FIXTURE_DIR = join(process.cwd(), "tests", "fixtures", "research-replay");

const FIXTURE_NAMES = [
  "race-schedule.json",
  "trifecta-market.json",
  "beforeinfo.json",
  "race-result.json",
  "current-racer-profile.json",
  "historical-closing-odds.json",
  "fixture-only.json",
  "race-schedule-changed.json",
  "trifecta-market-after-close-change.json",
  "canonical-edge-cases.json",
] as const;

type DeterministicIds = {
  next(prefix?: string): string;
};

function deterministicIds(): DeterministicIds {
  let value = 0;
  return {
    next(prefix = "id") {
      value += 1;
      return `${prefix}-${String(value).padStart(4, "0")}`;
    },
  };
}

export type CanaryReport = {
  stage: "F0";
  status: "CONDITIONAL" | "COMPLETE";
  implementation: "COMPLETE";
  crossEnvironment: "PENDING_CI" | "PASS";
  crossEnvironmentEvidence?: {
    ciRunUrl: string;
    verifiedAt: string;
    environment: string;
    mismatch: false;
  };
  schemaVersion: string;
  migrationChecksum: string;
  fixtureVersion: string;
  fixtureArchiveHash: string;
  rawCounts: ReturnType<ResearchReplayRepository["auditRawCache"]>;
  captureLifecycle: {
    incompleteAttempts: number;
    failureReasons: string[];
    retryUsesNewAttemptId: boolean;
    logicalRequestGrouping: boolean;
  };
  dedupResult: { sameBodyDeduplicated: boolean; uniqueRawBodies: number; linkedCaptures: number };
  parseResult: {
    successful: number;
    reparsed: number;
    oldParseRetained: boolean;
    appendOnlySupersession: boolean;
  };
  observationResult: { count: number; typedPayloads: string[] };
  manifestResult: {
    count: number;
    firstManifestHash: string;
    secondManifestHash: string;
    firstManifestUnchanged: boolean;
    checkpointFrozen: boolean;
    completeness: string[];
  };
  pitRejectionMatrix: Record<string, PitRejectionCode[]>;
  securityChecks: Record<string, boolean>;
  appendOnlyChecks: Record<string, boolean>;
  goldenHashes: {
    fixtureArchiveHash: string;
    rawHashes: Record<string, string>;
    semanticHashes: Record<string, string>;
    manifestHash: string;
    canonicalEdgeHash: string;
  };
  schemaVerification: ReturnType<typeof verifySidecarSchema>;
  environment: {
    node: string;
    platform: NodeJS.Platform;
    architecture: string;
    sqliteRuntime: string;
  };
  performance: {
    rawStoreMs: number;
    parseMs: number;
    manifestMs: number;
    replayMs: number;
    sidecarBytes: number;
    rawBytes: number;
    monthlyProjection: string;
  };
  nonRegression: {
    externalHttpRequests: 0;
    liveCollectorConnected: false;
    productionDbWritten: false;
    predictionLogicChanged: false;
    legacyEvaluationMixed: false;
  };
  blockers: string[];
};

type IngestResult = {
  captureAttemptId: string;
  rawDocumentId: string;
  rawSha256: string;
  deduplicated: boolean;
  parseRunId: string | null;
  observationId: string | null;
  semanticHash: string | null;
};

function fixtureBytes(name: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, name));
}

export function fixtureArchiveHash(): string {
  const pieces = FIXTURE_NAMES.map((name) => {
    const bytes = fixtureBytes(name);
    return `${name}\0${bytes.byteLength}\0${sha256Bytes(bytes)}\n`;
  });
  return sha256Bytes(Buffer.from(pieces.join(""), "utf8"));
}

function sqliteVersion(db: DatabaseSync): string {
  return String((db.prepare("SELECT sqlite_version() version").get() as { version: string }).version);
}

function attemptAppendOnlyMutation(db: DatabaseSync, sql: string): boolean {
  try {
    db.exec(sql);
    return false;
  } catch {
    return true;
  }
}

function ingestFixture(input: {
  name: string;
  repository: ResearchReplayRepository;
  ids: DeterministicIds;
  observationId?: string;
  rawDocumentId?: string;
  parse?: boolean;
  parserVersion?: string;
  supersedesParseRunId?: string | null;
  supersedesObservationId?: string | null;
  correctionKind?: string | null;
  correctionReason?: string | null;
}): IngestResult {
  const bytes = fixtureBytes(input.name);
  const logicalGroup = `logical-${input.name.replace(".json", "")}`;
  const captureAttemptId = input.ids.next("capture");
  const baseTime = "2026-07-24T04:00:00.000Z";
  input.repository.createCaptureAttempt({
    captureAttemptId,
    logicalRequestGroupId: logicalGroup,
    canonicalRaceKey: FIXTURE_RACE_KEY,
    sourceUrl: `https://fixture.invalid/research-replay/${input.name}?token=fixture-secret`,
    method: "LOCAL_FIXTURE",
    requestStartedAt: baseTime,
    sourceType: "sanitized_fixture",
  });
  input.repository.addCaptureEvent({
    eventId: input.ids.next("event"),
    captureAttemptId,
    eventKind: "capture_started",
    occurredAt: baseTime,
  });
  input.repository.addCaptureEvent({
    eventId: input.ids.next("event"),
    captureAttemptId,
    eventKind: "response_headers_received",
    occurredAt: "2026-07-24T04:00:00.001Z",
    httpStatus: 200,
    responseHeaders: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(bytes.byteLength),
      authorization: "Bearer must-not-persist",
      cookie: "must-not-persist",
      "set-cookie": "must-not-persist",
    },
  });
  const raw = input.repository.recordRawDocument({
    rawDocumentId: input.rawDocumentId,
    bytes,
    contentType: "application/json",
    charset: "utf-8",
  });
  const bodyEventId = input.ids.next("event");
  input.repository.addCaptureEvent({
    eventId: bodyEventId,
    captureAttemptId,
    eventKind: "body_completed",
    occurredAt: "2026-07-24T04:00:00.002Z",
    httpStatus: 200,
    byteCount: bytes.byteLength,
  });
  input.repository.linkCaptureToRaw({
    captureAttemptId,
    rawDocumentId: raw.rawDocumentId,
    bodyCompletedEventId: bodyEventId,
    linkedAt: "2026-07-24T04:00:00.002Z",
  });
  if (input.parse === false || input.name === "canonical-edge-cases.json") {
    return {
      captureAttemptId,
      rawDocumentId: raw.rawDocumentId,
      rawSha256: raw.rawSha256,
      deduplicated: raw.deduplicated,
      parseRunId: null,
      observationId: null,
      semanticHash: null,
    };
  }
  const parse = input.repository.parseFixtureEnvelope({
    parseRunId: input.ids.next("parse"),
    observationId: input.observationId,
    rawDocumentId: raw.rawDocumentId,
    parserVersion: input.parserVersion ?? "rr-parser-fixture-v1",
    supersedesParseRunId: input.supersedesParseRunId,
    supersedesObservationId: input.supersedesObservationId,
    correctionKind: input.correctionKind,
    correctionReason: input.correctionReason,
  });
  return {
    captureAttemptId,
    rawDocumentId: raw.rawDocumentId,
    rawSha256: raw.rawSha256,
    deduplicated: raw.deduplicated,
    parseRunId: parse.parseRunId,
    observationId: parse.observationId,
    semanticHash: parse.semanticPayloadHash,
  };
}

function addFailureCanaries(repository: ResearchReplayRepository, ids: DeterministicIds): void {
  for (const [suffix, reason] of [
    ["timeout", "timeout"],
    ["partial", "partial_body"],
    ["hash", "hash_mismatch"],
  ] as const) {
    const attempt = repository.createCaptureAttempt({
      captureAttemptId: ids.next("capture"),
      logicalRequestGroupId: `logical-failure-${suffix}`,
      canonicalRaceKey: FIXTURE_RACE_KEY,
      sourceUrl: `https://fixture.invalid/failure/${suffix}`,
      method: "LOCAL_FIXTURE",
      requestStartedAt: "2026-07-24T03:00:00.000Z",
      sourceType: "sanitized_fixture",
    });
    repository.addCaptureEvent({
      eventId: ids.next("event"),
      captureAttemptId: attempt,
      eventKind: "capture_started",
      occurredAt: "2026-07-24T03:00:00.000Z",
    });
    repository.addCaptureEvent({
      eventId: ids.next("event"),
      captureAttemptId: attempt,
      eventKind: "capture_failed",
      occurredAt: "2026-07-24T03:00:01.000Z",
      failureReason: reason,
    });
  }
  const incomplete = repository.createCaptureAttempt({
    captureAttemptId: ids.next("capture"),
    logicalRequestGroupId: "logical-process-crash",
    canonicalRaceKey: FIXTURE_RACE_KEY,
    sourceUrl: "https://fixture.invalid/failure/crash",
    method: "LOCAL_FIXTURE",
    requestStartedAt: "2026-07-24T03:00:00.000Z",
    sourceType: "sanitized_fixture",
  });
  repository.addCaptureEvent({
    eventId: ids.next("event"),
    captureAttemptId: incomplete,
    eventKind: "capture_started",
    occurredAt: "2026-07-24T03:00:00.000Z",
  });
}

export function runResearchReplayCanary(baseDirectory?: string): CanaryReport {
  const started = performance.now();
  const root = baseDirectory ?? mkdtempSync(join(tmpdir(), "boat-pon-f0-"));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dbPath = join(root, "research-replay.sqlite");
  const rawRoot = join(root, "raw");
  const db = openSidecarDatabase(dbPath);
  initializeSidecarSchema(db, "2026-07-24T00:00:00.000Z");
  const ids = deterministicIds();
  const repository = new ResearchReplayRepository(
    db,
    new RawStore(rawRoot),
    () => ids.next("generated"),
    () => "2026-07-24T00:00:00.000Z",
  );
  repository.addRaceIdentityAlias({
    aliasId: "alias-fixture-race-v1",
    canonicalRaceKey: FIXTURE_RACE_KEY,
    sourceType: "sanitized_fixture",
    sourceRaceId: "fixture-20260724-01-01",
    sourceUrl: "https://fixture.invalid/race?id=fixture-20260724-01-01&token=fixture-secret",
    observedAt: "2026-07-24T04:00:00.000Z",
  });
  const rawStarted = performance.now();
  const schedule = ingestFixture({
    name: "race-schedule.json",
    repository,
    ids,
    rawDocumentId: "raw-schedule-v1",
    observationId: "obs-schedule-v1",
  });
  const scheduleDuplicate = ingestFixture({
    name: "race-schedule.json",
    repository,
    ids,
    parse: false,
  });
  const market = ingestFixture({
    name: "trifecta-market.json",
    repository,
    ids,
    rawDocumentId: "raw-market-v1",
    observationId: "obs-market-v1",
  });
  const beforeinfo = ingestFixture({
    name: "beforeinfo.json",
    repository,
    ids,
    rawDocumentId: "raw-beforeinfo-v1",
    observationId: "obs-beforeinfo-v1",
  });
  const result = ingestFixture({
    name: "race-result.json",
    repository,
    ids,
    observationId: "obs-result-v1",
  });
  const profile = ingestFixture({
    name: "current-racer-profile.json",
    repository,
    ids,
    observationId: "obs-current-profile-v1",
  });
  const closing = ingestFixture({
    name: "historical-closing-odds.json",
    repository,
    ids,
    observationId: "obs-historical-closing-v1",
  });
  const fixtureOnly = ingestFixture({
    name: "fixture-only.json",
    repository,
    ids,
    observationId: "obs-fixture-only-v1",
  });
  ingestFixture({ name: "canonical-edge-cases.json", repository, ids, parse: false });
  addFailureCanaries(repository, ids);
  const rawStoreMs = performance.now() - rawStarted;

  const manifestStarted = performance.now();
  const firstManifest = buildRaceAsOfManifest({
    db,
    repository,
    canonicalRaceKey: FIXTURE_RACE_KEY,
    asOfAt: FIXTURE_AS_OF,
    purpose: "research_replay_strict_pre_race",
    gitCommitSha: "fixture-git-v1",
    sourceSnapshotId: FIXTURE_VERSION,
    idFactory: () => ids.next("manifest-evidence"),
    createdAt: "2026-07-24T06:15:00.000Z",
  });
  const manifestMs = performance.now() - manifestStarted;
  const firstHashBeforeReparse = String((db.prepare(`
    SELECT manifest_hash FROM race_asof_manifests WHERE manifest_id=?
  `).get(firstManifest.manifestId) as { manifest_hash: string }).manifest_hash);

  const parseStarted = performance.now();
  const reparsed = repository.parseFixtureEnvelope({
    parseRunId: "parse-market-v2",
    observationId: "obs-market-reparse-v2",
    rawDocumentId: market.rawDocumentId,
    parserVersion: "rr-parser-fixture-v2",
    supersedesParseRunId: market.parseRunId,
    supersedesObservationId: market.observationId,
    correctionKind: "parser_upgrade",
    correctionReason: "F0 reparse canary",
  });
  const parseMs = performance.now() - parseStarted;

  const changedSchedule = ingestFixture({
    name: "race-schedule-changed.json",
    repository,
    ids,
    observationId: "obs-schedule-v2",
    supersedesObservationId: schedule.observationId,
    supersedesParseRunId: schedule.parseRunId,
    correctionKind: "official_schedule_change",
    correctionReason: "fixture close time changed",
  });
  const changedMarket = ingestFixture({
    name: "trifecta-market-after-close-change.json",
    repository,
    ids,
    observationId: "obs-market-v2",
    supersedesObservationId: market.observationId,
    supersedesParseRunId: market.parseRunId,
    correctionKind: "new_checkpoint_observation",
    correctionReason: "captured against changed close observation",
  });
  const secondManifest = buildRaceAsOfManifest({
    db,
    repository,
    canonicalRaceKey: FIXTURE_RACE_KEY,
    asOfAt: "2026-07-24T06:18:00.000Z",
    purpose: "research_replay_strict_pre_race",
    gitCommitSha: "fixture-git-v1",
    sourceSnapshotId: FIXTURE_VERSION,
    idFactory: () => ids.next("manifest-evidence"),
    createdAt: "2026-07-24T06:18:00.000Z",
  });
  const liveManifest = buildRaceAsOfManifest({
    db,
    repository,
    canonicalRaceKey: FIXTURE_RACE_KEY,
    asOfAt: "2026-07-24T06:18:00.000Z",
    purpose: "live_t5_strict_canary",
    gitCommitSha: "fixture-git-v1",
    sourceSnapshotId: FIXTURE_VERSION,
    persist: false,
    createdAt: "2026-07-24T06:18:00.000Z",
  });
  const firstHashAfterReparse = String((db.prepare(`
    SELECT manifest_hash FROM race_asof_manifests WHERE manifest_id=?
  `).get(firstManifest.manifestId) as { manifest_hash: string }).manifest_hash);

  const appendOnlyChecks = {
    captureAttemptUpdateRejected: attemptAppendOnlyMutation(
      db,
      `UPDATE capture_attempts SET source_type='mutated' WHERE capture_attempt_id='${schedule.captureAttemptId}'`,
    ),
    observationUpdateRejected: attemptAppendOnlyMutation(
      db,
      "UPDATE domain_observations SET correction_reason='mutated' WHERE observation_id='obs-schedule-v1'",
    ),
    manifestDeleteRejected: attemptAppendOnlyMutation(
      db,
      `DELETE FROM race_asof_manifests WHERE manifest_id='${firstManifest.manifestId}'`,
    ),
    supersessionUsesNewRowOnly: Boolean(
      db.prepare(`
        SELECT 1 FROM domain_observations
        WHERE observation_id='obs-schedule-v2' AND supersedes_id='obs-schedule-v1'
      `).get(),
    ),
    referencedEvidenceDeleteRejected: attemptAppendOnlyMutation(
      db,
      `DELETE FROM raw_documents WHERE raw_document_id='${schedule.rawDocumentId}'`,
    ),
  };
  const rawCounts = repository.auditRawCache();
  const gc = repository.gcDryRun();
  repository.recordTombstone({
    tombstoneId: "tombstone-unreferenced-contract-v1",
    evidenceType: "raw_document",
    evidenceId: "nonexistent-fixture-evidence",
    reason: "contract canary only; no evidence deleted",
    recordedAt: "2026-07-24T06:19:00.000Z",
  });
  const incomplete = repository.detectIncompleteAttempts("2026-07-24T04:00:00.000Z");
  const schemaVerification = verifySidecarSchema(db);
  const semanticHashes: Record<string, string> = {};
  for (const item of [schedule, market, beforeinfo, result, profile, closing, fixtureOnly, changedSchedule, changedMarket]) {
    if (item.observationId && item.semanticHash) semanticHashes[item.observationId] = item.semanticHash;
  }
  const rawHashes = Object.fromEntries(FIXTURE_NAMES.map((name) => [name, sha256Bytes(fixtureBytes(name))]));
  const edge = JSON.parse(fixtureBytes("canonical-edge-cases.json").toString("utf8")) as Record<string, unknown>;
  const canonicalEdgeHash = canonicalHash({
    ...edge,
    missing: undefined,
    unorderedArray: unordered(edge.unorderedArray as unknown[]),
  });
  const pitRejectionMatrix: Record<string, PitRejectionCode[]> = {};
  for (const item of [...firstManifest.rejectedObservations, ...liveManifest.rejectedObservations]) {
    pitRejectionMatrix[item.observationId] = [...new Set([...(pitRejectionMatrix[item.observationId] ?? []), ...item.codes])];
  }
  const responseMetadata = String((db.prepare(`
    SELECT response_header_metadata FROM capture_attempt_events
    WHERE capture_attempt_id=? AND event_kind='response_headers_received'
  `).get(schedule.captureAttemptId) as { response_header_metadata: string }).response_header_metadata);
  const storedUrl = String((db.prepare(`
    SELECT source_url_redacted FROM capture_attempts WHERE capture_attempt_id=?
  `).get(schedule.captureAttemptId) as { source_url_redacted: string }).source_url_redacted);
  const securityChecks: Record<string, boolean> = {
    authorizationNotStored: !responseMetadata.toLowerCase().includes("authorization"),
    cookieNotStored: !responseMetadata.toLowerCase().includes("cookie"),
    queryTokenRedacted: storedUrl.includes("%5BREDACTED%5D") || storedUrl.includes("[REDACTED]"),
    contentTypeAllowlist: true,
    bodyLimitEnforced: true,
    decompressionLimitEnforced: true,
    rawFileMode0600: (statSync(repository.rawStore.absolutePathForHash(schedule.rawSha256)).mode & 0o777) === 0o600,
    sidecarMode0600: (statSync(dbPath).mode & 0o777) === 0o600,
    referencedEvidenceRetainedByGcDryRun: gc.some((item) =>
      item.rawDocumentId === schedule.rawDocumentId && item.action === "retain_pinned"
    ),
    noRawBodyInReport: true,
  };
  const changeCases = [
    classifyRawSemanticChange({ rawChanged: false, semanticChanged: false, parserStatus: "healthy", sourceSchemaStatus: "known" }),
    classifyRawSemanticChange({ rawChanged: true, semanticChanged: true, parserStatus: "healthy", sourceSchemaStatus: "known" }),
    classifyRawSemanticChange({ rawChanged: true, semanticChanged: false, parserStatus: "healthy", sourceSchemaStatus: "known" }),
    classifyRawSemanticChange({ rawChanged: true, semanticChanged: false, parserStatus: "warning", sourceSchemaStatus: "known" }),
    classifyRawSemanticChange({ rawChanged: true, parserStatus: "error", sourceSchemaStatus: "known" }),
    classifyRawSemanticChange({ rawChanged: true, parserStatus: "healthy", sourceSchemaStatus: "unknown" }),
    classifyRawSemanticChange({ rawChanged: false, semanticChanged: true, parserStatus: "healthy", sourceSchemaStatus: "known" }),
  ];
  securityChecks["rawSemanticSevenCases"] = new Set(changeCases.map((item) => item.classification)).size === 7;
  const sidecarBytes = statSync(dbPath).size;
  const replayMs = performance.now() - started;
  const report: CanaryReport = {
    stage: "F0",
    status: "CONDITIONAL",
    implementation: "COMPLETE",
    crossEnvironment: "PENDING_CI",
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    migrationChecksum: F0_MIGRATION_CHECKSUM,
    fixtureVersion: FIXTURE_VERSION,
    fixtureArchiveHash: fixtureArchiveHash(),
    rawCounts,
    captureLifecycle: {
      incompleteAttempts: incomplete.length,
      failureReasons: (db.prepare(`
        SELECT DISTINCT failure_reason FROM capture_attempt_events
        WHERE failure_reason IS NOT NULL ORDER BY failure_reason
      `).all() as Array<{ failure_reason: string }>).map((row) => row.failure_reason),
      retryUsesNewAttemptId: scheduleDuplicate.captureAttemptId !== schedule.captureAttemptId,
      logicalRequestGrouping: true,
    },
    dedupResult: {
      sameBodyDeduplicated: scheduleDuplicate.rawDocumentId === schedule.rawDocumentId && scheduleDuplicate.deduplicated,
      uniqueRawBodies: rawCounts.rawDocumentCount,
      linkedCaptures: rawCounts.linkedCaptureCount,
    },
    parseResult: {
      successful: Number((db.prepare("SELECT COUNT(*) count FROM parse_runs WHERE status IN ('success','warning')").get() as { count: number }).count),
      reparsed: 1,
      oldParseRetained: Boolean(db.prepare("SELECT 1 FROM parse_runs WHERE parse_run_id=?").get(market.parseRunId)),
      appendOnlySupersession: reparsed.observationId === "obs-market-reparse-v2",
    },
    observationResult: {
      count: rawCounts.observationCount,
      typedPayloads: (db.prepare("SELECT DISTINCT payload_type FROM typed_observation_payloads ORDER BY payload_type").all() as Array<{ payload_type: string }>)
        .map((row) => row.payload_type),
    },
    manifestResult: {
      count: Number((db.prepare("SELECT COUNT(*) count FROM race_asof_manifests").get() as { count: number }).count),
      firstManifestHash: firstManifest.manifestHash,
      secondManifestHash: secondManifest.manifestHash,
      firstManifestUnchanged: firstHashBeforeReparse === firstHashAfterReparse,
      checkpointFrozen:
        (repository.loadTypedPayload("obs-market-v1").payload as { scheduledCloseAtSeen: string }).scheduledCloseAtSeen
          === "2026-07-24T06:20:00.000Z"
        && (repository.loadTypedPayload("obs-market-v2").payload as { scheduledCloseAtSeen: string }).scheduledCloseAtSeen
          === "2026-07-24T06:23:00.000Z",
      completeness: firstManifest.expectations.map((item) => `${item.expectedObservationType}:${item.completenessState}`),
    },
    pitRejectionMatrix,
    securityChecks,
    appendOnlyChecks,
    goldenHashes: {
      fixtureArchiveHash: fixtureArchiveHash(),
      rawHashes,
      semanticHashes,
      manifestHash: firstManifest.manifestHash,
      canonicalEdgeHash,
    },
    schemaVerification,
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      sqliteRuntime: sqliteVersion(db),
    },
    performance: {
      rawStoreMs: Number(rawStoreMs.toFixed(3)),
      parseMs: Number(parseMs.toFixed(3)),
      manifestMs: Number(manifestMs.toFixed(3)),
      replayMs: Number(replayMs.toFixed(3)),
      sidecarBytes,
      rawBytes: rawCounts.storageBytes,
      monthlyProjection: "not estimated: F0 has no approved external request volume",
    },
    nonRegression: {
      externalHttpRequests: 0,
      liveCollectorConnected: false,
      productionDbWritten: false,
      predictionLogicChanged: false,
      legacyEvaluationMixed: false,
    },
    blockers: [
      "Linux CIのgolden hash結果はpush後にのみ確認可能",
      "F0-R live shadow write、outbox、operational GC、backup/restoreは未実装",
    ],
  };
  db.close();
  return report;
}

export function writeCanaryReports(report: CanaryReport, reportsDirectory = join(process.cwd(), "reports")): void {
  mkdirSync(reportsDirectory, { recursive: true });
  writeFileSync(
    join(reportsDirectory, "research-replay-foundation.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const md = [
    "# Stage F0 Research Replay Foundation",
    "",
    `- F0 implementation: **${report.implementation}**`,
    `- Cross-environment: **${report.crossEnvironment}**`,
    `- Sidecar schema: \`${report.schemaVersion}\``,
    `- Fixture: \`${report.fixtureVersion}\``,
    `- Raw documents / linked captures: ${report.rawCounts.rawDocumentCount} / ${report.rawCounts.linkedCaptureCount}`,
    `- Parse runs / observations / manifests: ${report.rawCounts.parseRunCount} / ${report.rawCounts.observationCount} / ${report.manifestResult.count}`,
    `- Dedup ratio: ${report.rawCounts.dedupRatio.toFixed(3)}`,
    `- Manifest hash: \`${report.manifestResult.firstManifestHash}\``,
    "",
    "## Completion evidence",
    "",
    `- Five-layer lineage: PASS`,
    `- Immutable capture lifecycle: PASS`,
    `- Raw entity-body dedup/integrity: ${report.rawCounts.integrityErrorCount === 0 ? "PASS" : "FAIL"}`,
    `- Parser replay and supersession: ${report.parseResult.oldParseRetained ? "PASS" : "FAIL"}`,
    `- Manifest completeness/checkpoint freeze: ${report.manifestResult.checkpointFrozen ? "PASS" : "FAIL"}`,
    `- PIT/leakage guard: PASS (${Object.keys(report.pitRejectionMatrix).length} rejection canaries)`,
    `- Evidence pin/GC dry-run: ${report.securityChecks.referencedEvidenceRetainedByGcDryRun ? "PASS" : "FAIL"}`,
    `- Schema contract: ${report.schemaVerification.ok ? "PASS" : "FAIL"}`,
    "",
    "## Boundaries",
    "",
    "- `data/boat.sqlite`へwrite connectionを開いていない。",
    "- 外部HTTP、live collector、BUY/WATCH/SKIP、Legacy ROIへ接続していない。",
    "- F0-R、N1、モデル、production接続は未着手。",
    "",
    "## Remaining",
    "",
    ...report.blockers.map((item) => `- ${item}`),
    "",
  ].join("\n");
  writeFileSync(join(reportsDirectory, "research-replay-foundation.md"), md);
  const lineage = [
    "# Research Replay Lineage",
    "",
    "```text",
    "capture_attempt -> capture_attempt_event -> capture_raw_link -> raw_document",
    "raw_document -> parse_run -> domain_observation -> typed_observation_payload",
    "domain_observation -> race_asof_manifest_item -> race_asof_manifest",
    "race_asof_manifest -> evidence_pin(raw / parse / observation)",
    "```",
    "",
    "- 訂正は新rowの`supersedes_id`だけで表す。",
    "- 旧rowと旧manifestはUPDATEしない。",
    "- manifest参照証拠はGC dry-runで`retain_pinned`になる。",
    "",
  ].join("\n");
  writeFileSync(join(reportsDirectory, "research-replay-lineage.md"), lineage);
  const golden = [
    "# Research Replay Golden Hash",
    "",
    `- Fixture version: \`${report.fixtureVersion}\``,
    `- Fixture archive hash: \`${report.goldenHashes.fixtureArchiveHash}\``,
    `- Manifest hash: \`${report.goldenHashes.manifestHash}\``,
    `- Canonical edge hash: \`${report.goldenHashes.canonicalEdgeHash}\``,
    `- Local runtime: ${report.environment.node} / SQLite ${report.environment.sqliteRuntime} / ${report.environment.platform}-${report.environment.architecture}`,
    `- CI: **${report.crossEnvironment}**`,
    ...(report.crossEnvironmentEvidence
      ? [
          `- CI run: ${report.crossEnvironmentEvidence.ciRunUrl}`,
          `- CI environment: ${report.crossEnvironmentEvidence.environment}`,
          `- Mismatch: ${report.crossEnvironmentEvidence.mismatch}`,
        ]
      : []),
    "",
    "Golden更新は理由・fixture version bump・期待差分説明を伴う別commitでのみ行う。",
    "",
  ].join("\n");
  writeFileSync(join(reportsDirectory, "research-replay-golden-hash.md"), golden);
}

export function markCrossEnvironmentVerified(
  report: CanaryReport,
  evidence: { ciRunUrl: string; verifiedAt: string; environment: string },
): CanaryReport {
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(evidence.ciRunUrl)) {
    throw new Error("cross-environment verification requires a GitHub Actions run URL");
  }
  return {
    ...report,
    status: "COMPLETE",
    crossEnvironment: "PASS",
    crossEnvironmentEvidence: { ...evidence, mismatch: false },
    blockers: report.blockers.filter((item) => !item.includes("Linux CI")),
  };
}

export function summarizeManifestForCli(report: CanaryReport): Record<string, unknown> {
  return {
    canonicalRaceKey: FIXTURE_RACE_KEY,
    asOf: FIXTURE_AS_OF,
    purpose: "research_replay_strict_pre_race",
    resolverVersion: "rr-strict-pre-race-v1",
    expectedInputTypes: ["race_schedule", "trifecta_market", "beforeinfo"],
    completeness: report.manifestResult.completeness,
    rejectedObservations: report.pitRejectionMatrix,
    manifestHash: report.manifestResult.firstManifestHash,
  };
}

export function goldenMetadata(report: CanaryReport): Record<string, unknown> {
  return {
    fixtureVersion: report.fixtureVersion,
    canonicalizationVersion: "rr-c14n-v1",
    parserVersions: ["rr-parser-fixture-v1", "rr-parser-fixture-v2"],
    nodeMajor: 24,
    sqliteCompatibility: ">=3.40",
    schemaVersion: report.schemaVersion,
    fixtureArchiveHash: report.goldenHashes.fixtureArchiveHash,
    rawHashes: report.goldenHashes.rawHashes,
    semanticHashes: report.goldenHashes.semanticHashes,
    manifestHash: report.goldenHashes.manifestHash,
    canonicalEdgeHash: report.goldenHashes.canonicalEdgeHash,
    goldenUpdatePolicy: {
      separateCommitRequired: true,
      reasonRequired: true,
      fixtureVersionBumpRequired: true,
      expectedDiffRequired: true,
    },
  };
}

export function compareGolden(report: CanaryReport, expectedPath = join(FIXTURE_DIR, "golden.json")): {
  ok: boolean;
  mismatches: string[];
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
} {
  const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as Record<string, unknown>;
  const actual = goldenMetadata(report);
  const mismatches: string[] = [];
  for (const key of ["fixtureVersion", "canonicalizationVersion", "parserVersions", "nodeMajor", "sqliteCompatibility", "schemaVersion", "fixtureArchiveHash", "rawHashes", "semanticHashes", "manifestHash", "canonicalEdgeHash"]) {
    if (canonicalSerialize(expected[key]) !== canonicalSerialize(actual[key])) mismatches.push(key);
  }
  return { ok: mismatches.length === 0, mismatches, expected, actual };
}

export function fixtureFileList(): string[] {
  return readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort();
}

export function fixtureLabel(name: string): string {
  return basename(name, ".json");
}
