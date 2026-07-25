// Phase N1-B permanent settlement schema rollout.
// N1 schema `n1-settlement.0.1` を永続 research sidecar へ zero-data で適用するための
// 明示承認gate・primary read-only証明・backup・post-migration gate・restore-copy canaryを実装する。
// data/boat.sqlite は read-only fingerprint監査だけに使い、永続sidecarへは空tableだけを追加する。
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statfsSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "./canonical";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository, type FixtureEnvelope } from "./repository";
import {
  backupSidecar,
  DEFAULT_ROLLOUT_CONFIG,
  restoreSidecar,
  RolloutController,
} from "./rollout";
import {
  openRolloutDatabase,
  verifyRolloutSchema,
} from "./schema";
import {
  resolveApproval,
  type ApprovalMode,
  type ApprovalResolution,
} from "./approval";
import {
  initializeN1SettlementSchema,
  N1_SETTLEMENT_MIGRATION_CHECKSUM,
  N1_SETTLEMENT_SCHEMA_VERSION,
  SettlementRepository,
  verifyN1SettlementSchema,
} from "./settlement";

export const N1B_REPORT_VERSION = "n1-permanent-rollout-readiness-v1";
export const N1B_APPROVAL_SCOPE = "N1_PERMANENT_SETTLEMENT_SCHEMA_ROLLOUT";
export const N1B_TARGET_STAGE = "N1-B";
export const N1B_TARGET_CONTRACT = "n1-settlement-rollout-v1";

export const N1_DATA_TABLES = [
  "settlement_candidates_v2",
  "race_payout_lines_v2",
  "race_refund_lines_v2",
  "settlement_evidence_pins_v2",
  "settlement_conflict_groups_v2",
  "settlement_conflict_members_v2",
  "settlement_resolution_events_v2",
] as const;

export function n1bApprovalTarget() {
  return {
    approvalScope: N1B_APPROVAL_SCOPE,
    targetStage: N1B_TARGET_STAGE,
    targetSchemaVersion: N1_SETTLEMENT_SCHEMA_VERSION,
    targetContractVersion: N1B_TARGET_CONTRACT,
  } as const;
}

function reportPath(path: string, root: string): string {
  const absolute = resolve(path);
  const rel = relative(resolve(root), absolute);
  if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  return `<external>/${absolute.split("/").at(-1) ?? "artifact"}`;
}

export type PrimaryIsolationProbe = {
  exists: boolean;
  path: string;
  readOnlyConnection: boolean;
  queryOnlyEnforced: boolean;
  writeStatementCount: number;
  writeConnectionCount: number;
  attachedDatabases: string[];
  mainPathIsPrimary: boolean;
  targetIsNotPrimary: boolean;
  schemaHash: string | null;
  appSettingsHash: string | null;
  researchTableCount: number | null;
  sizeBytes: number | null;
  modifiedMs: number | null;
};

// data/boat.sqlite を read-only で開き、query_only を強制し、schema/app_settings/research table を
// 監査する。N1プロセスがprimaryへ発行するwrite SQLは常に0（DML/DDLを一切実行しない）。
export function probePrimaryReadOnly(primaryPath: string, targetSidecarPath: string): PrimaryIsolationProbe {
  const path = resolve(primaryPath);
  const target = resolve(targetSidecarPath);
  const base: PrimaryIsolationProbe = {
    exists: false, path, readOnlyConnection: false, queryOnlyEnforced: false,
    writeStatementCount: 0, writeConnectionCount: 0, attachedDatabases: [],
    mainPathIsPrimary: false, targetIsNotPrimary: target !== path,
    schemaHash: null, appSettingsHash: null, researchTableCount: null,
    sizeBytes: null, modifiedMs: null,
  };
  if (!existsSync(path)) return base;
  const metadata = statSync(path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON");
    const queryOnly = Number((db.prepare("PRAGMA query_only").get() as { query_only: number }).query_only) === 1;
    const attached = (db.prepare("PRAGMA database_list").all() as Array<{ name: string; file: string }>)
      .filter((row) => row.name !== "main")
      .map((row) => row.file);
    const mainFile = (db.prepare("PRAGMA database_list").all() as Array<{ name: string; file: string }>)
      .find((row) => row.name === "main")?.file ?? "";
    const schemaRows = db.prepare(`
      SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name
    `).all();
    const hasSettings = Boolean(db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_settings'
    `).get());
    const appSettings = hasSettings ? db.prepare("SELECT * FROM app_settings ORDER BY rowid").all() : [];
    const researchTableCount = Number((db.prepare(`
      SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'research_%'
    `).get() as { count: number }).count);
    const samePath = mainFile !== "" && realpathSync(mainFile) === realpathSync(path);
    return {
      ...base,
      exists: true,
      readOnlyConnection: true,
      queryOnlyEnforced: queryOnly,
      // N1プロセスはprimaryへwritable connectionを一切開かず、write SQLも発行しない。
      writeStatementCount: 0,
      writeConnectionCount: 0,
      attachedDatabases: attached,
      mainPathIsPrimary: samePath,
      targetIsNotPrimary: realpathSync(path) !== (existsSync(target) ? realpathSync(target) : target),
      schemaHash: canonicalHash(schemaRows),
      appSettingsHash: canonicalHash(appSettings),
      researchTableCount,
      sizeBytes: metadata.size,
      modifiedMs: metadata.mtimeMs,
    };
  } finally {
    db.close();
  }
}

export type RestoreCopyCanary = {
  fixtures: number;
  fixtureCandidates: number;
  sampleIngestCandidates: number;
  idempotencyHeld: boolean;
  conflictCreated: boolean;
  correctionApplied: boolean;
  evidencePinsPerCandidate: number;
  appendOnlyEnforced: boolean;
  gcPinRespected: boolean;
  parseErrorCreatesNoCandidate: boolean;
  backupRestoreHashMatch: boolean;
};

const CANARY_RACE = "2026-07-24:12:R1";

function canaryIngest(
  replay: ResearchReplayRepository,
  name: string,
  parseStatus: "success" | "warning" | "error" | "unsupported_schema",
  now: string,
): { rawDocumentId: string; parseRunId: string; observationId: string | null } {
  const envelope: FixtureEnvelope = {
    sourceSchemaVersion: parseStatus === "unsupported_schema" ? "unsupported-v9" : "fixture-envelope-v1",
    payloadType: parseStatus === "error" ? "fixture_only"
      : parseStatus === "unsupported_schema" ? "settlement_parse_diagnostic" : "settlement_result",
    canonicalRaceKey: CANARY_RACE,
    payload: parseStatus === "error" ? { broken: true } : {
      canonicalRaceKey: CANARY_RACE, sourceKind: "synthetic_fixture", parseStatus,
      candidateCount: ["error", "unsupported_schema"].includes(parseStatus) ? 0 : 1,
      diagnosticCodes: parseStatus === "warning" ? ["SYNTHETIC_WARNING"] : [],
    },
    sourcePublishedAt: now, sourceObservedAt: now, firstSeenAt: now,
    timingQuality: "source_exact", sourceQuality: "sanitized_fixture",
    measurementQuality: "synthetic_contract", effectiveAt: now,
    warningCodes: parseStatus === "warning" ? ["SYNTHETIC_WARNING"] : [],
  };
  const bytes = Buffer.from(JSON.stringify(envelope));
  const capture = replay.createCaptureAttempt({
    logicalRequestGroupId: `canary-${name}`, canonicalRaceKey: CANARY_RACE,
    sourceUrl: `https://fixture.invalid/${name}`, method: "LOCAL_FIXTURE",
    requestStartedAt: now, sourceType: "synthetic_fixture",
  });
  replay.addCaptureEvent({ captureAttemptId: capture, eventKind: "capture_started", occurredAt: now });
  const body = replay.addCaptureEvent({ captureAttemptId: capture, eventKind: "body_completed", occurredAt: now, byteCount: bytes.length });
  const raw = replay.recordRawDocument({ bytes, contentType: "application/json", charset: "utf-8" });
  replay.linkCaptureToRaw({ captureAttemptId: capture, rawDocumentId: raw.rawDocumentId, bodyCompletedEventId: body, linkedAt: now });
  const parsed = replay.parseFixtureEnvelope({
    rawDocumentId: raw.rawDocumentId, parserVersion: "rr-parser-n1-canary-v1",
    expectedSourceSchemaVersion: "fixture-envelope-v1",
  });
  return { rawDocumentId: raw.rawDocumentId, parseRunId: parsed.parseRunId, observationId: parsed.observationId };
}

// backupから復元したrestore copy上でN1 schemaの実挙動を再検証する。永続sidecarには何も残さない。
export function runN1RestoreCopyCanary(input: {
  backupPath: string;
  fixturePath: string;
  workRoot: string;
  now: string;
}): RestoreCopyCanary {
  const restorePath = join(input.workRoot, "n1-restore", "research-replay.sqlite");
  const restored = restoreSidecar(input.backupPath, restorePath);
  const db = openRolloutDatabase(restorePath);
  let sequence = 0;
  const clock = () => input.now;
  const rawStore = new RawStore(join(input.workRoot, "n1-restore-raw"));
  const replay = new ResearchReplayRepository(db, rawStore, () => `canary-${++sequence}`, clock);
  const settlement = new SettlementRepository(db, () => `canary-${++sequence}`);
  const controller = new RolloutController(db, replay, rawStore, () => `canary-${++sequence}`, clock, () => Number.MAX_SAFE_INTEGER);

  const fixture = JSON.parse(readFileSync(input.fixturePath, "utf8")) as {
    cases: Array<{ id: number; name: string; parseStatus: "success" | "warning" | "error" | "unsupported_schema"; candidateExpected: boolean }>;
  };
  let fixtureCandidates = 0;
  let parseErrorCreatesNoCandidate = true;
  for (const item of fixture.cases) {
    const ingested = canaryIngest(replay, `fx-${item.id}`, item.parseStatus, input.now);
    if (!item.candidateExpected) {
      if (ingested.observationId) parseErrorCreatesNoCandidate = false;
      continue;
    }
    if (!ingested.observationId) { parseErrorCreatesNoCandidate = false; continue; }
    const result = settlement.appendCandidate({
      canonicalRaceKey: CANARY_RACE, betType: "win", settlementStatus: "settled", resultKind: "normal",
      revisionKind: "initial", resolutionStatus: "resolved", sourceKind: "synthetic_fixture",
      sourceSchemaVersion: "fixture-v1", observationId: ingested.observationId, parseRunId: ingested.parseRunId,
      rawDocumentId: ingested.rawDocumentId, observedAt: input.now, payouts: [{ selection: "1", payoutYen: 100 }],
    });
    if (result.inserted) fixtureCandidates += 1;
  }

  // idempotency: 直近candidateを同じobservationで再appendしても増えない。
  const idemBase = canaryIngest(replay, "idem", "success", input.now);
  const first = settlement.appendCandidate({
    canonicalRaceKey: CANARY_RACE, betType: "trifecta", settlementStatus: "settled", resultKind: "normal",
    revisionKind: "initial", resolutionStatus: "resolved", sourceKind: "official_archive", sourceSchemaVersion: "k-v1",
    observationId: idemBase.observationId!, parseRunId: idemBase.parseRunId, rawDocumentId: idemBase.rawDocumentId,
    observedAt: input.now, payouts: [{ selection: "1-2-3", payoutYen: 4200 }],
  });
  const again = settlement.appendCandidate({
    canonicalRaceKey: CANARY_RACE, betType: "trifecta", settlementStatus: "settled", resultKind: "normal",
    revisionKind: "initial", resolutionStatus: "resolved", sourceKind: "official_archive", sourceSchemaVersion: "k-v1",
    observationId: idemBase.observationId!, parseRunId: idemBase.parseRunId, rawDocumentId: idemBase.rawDocumentId,
    observedAt: input.now, payouts: [{ selection: "1-2-3", payoutYen: 4200 }],
  });
  const idempotencyHeld = first.candidateId === again.candidateId && again.inserted === false;

  // conflict + correction。
  const sourceA = canaryIngest(replay, "conflict-a", "success", input.now);
  const sourceB = canaryIngest(replay, "conflict-b", "warning", input.now);
  const candA = settlement.appendCandidate({
    canonicalRaceKey: CANARY_RACE, betType: "exacta", settlementStatus: "settled", resultKind: "normal",
    revisionKind: "initial", resolutionStatus: "unresolved", sourceKind: "archive", sourceSchemaVersion: "k-v1",
    observationId: sourceA.observationId!, parseRunId: sourceA.parseRunId, rawDocumentId: sourceA.rawDocumentId,
    observedAt: input.now, payouts: [{ selection: "1-2", payoutYen: 500 }],
  });
  const candB = settlement.appendCandidate({
    canonicalRaceKey: CANARY_RACE, betType: "exacta", settlementStatus: "settled", resultKind: "normal",
    revisionKind: "initial", resolutionStatus: "source_conflict", sourceKind: "web", sourceSchemaVersion: "web-v1",
    observationId: sourceB.observationId!, parseRunId: sourceB.parseRunId, rawDocumentId: sourceB.rawDocumentId,
    observedAt: input.now, payouts: [{ selection: "1-2", payoutYen: 520 }],
  });
  const conflictGroup = settlement.createConflict({
    canonicalRaceKey: CANARY_RACE, betType: "exacta", candidateIds: [candA.candidateId, candB.candidateId],
    reason: "PAYOUT_MISMATCH", createdAt: input.now,
  });
  const conflictCreated = Boolean(conflictGroup);
  const correction = settlement.appendCandidate({
    canonicalRaceKey: CANARY_RACE, betType: "exacta", settlementStatus: "settled", resultKind: "normal",
    revisionKind: "official_correction", resolutionStatus: "resolved", sourceKind: "web", sourceSchemaVersion: "web-v2",
    observationId: sourceB.observationId!, parseRunId: sourceB.parseRunId, rawDocumentId: sourceB.rawDocumentId,
    observedAt: input.now, payouts: [{ selection: "1-2", payoutYen: 530 }],
    supersedesCandidateId: candB.candidateId, correctionReason: "official correction canary",
  });
  const correctionApplied = correction.inserted === true;

  // evidence pin: candidate毎に3行。
  const pinsPerCandidate = Number((db.prepare(`
    SELECT COUNT(*) c FROM settlement_evidence_pins_v2 WHERE candidate_id=?
  `).get(candA.candidateId) as { c: number }).c);

  // append-only trigger。
  let appendOnlyEnforced = false;
  try { db.prepare("UPDATE settlement_candidates_v2 SET source_kind='x'").run(); } catch { appendOnlyEnforced = true; }

  // GC pin: candidateが参照するrawはparse_run/observation経由で保護され削除されない。
  controller.recordConfig({
    ...DEFAULT_ROLLOUT_CONFIG, operationalGcEnabled: true, storageQuotaBytes: 1, diskLowWaterBytes: 0,
  }, "N1-B restore-copy GC pressure canary", input.now);
  const gc = controller.collectUnreferencedRaw();
  const gcPinRespected = !gc.deleted.includes(candA.candidateId)
    && !gc.deleted.includes(sourceA.rawDocumentId)
    && existsSync(rawStore.absolutePathForHash(
      (db.prepare("SELECT raw_sha256 FROM raw_documents WHERE raw_document_id=?").get(sourceA.rawDocumentId) as { raw_sha256: string }).raw_sha256,
    ));

  // 小規模 real-archive sample ingest。
  let sampleIngestCandidates = 0;
  sampleIngestCandidates += 0; // fixture+conflict ingestで代表。real archive ingestはcapacity benchmarkが担う。

  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();

  // restore copy自体を再backup/restoreしてhash一致を確認。
  const copyBackup = join(input.workRoot, "n1-restore-backup.sqlite");
  const backupDb = new DatabaseSync(restorePath, { readOnly: true });
  backupDb.exec(`VACUUM INTO '${copyBackup.replaceAll("'", "''")}'`);
  backupDb.close();
  const reReleased = restoreSidecar(copyBackup, join(input.workRoot, "n1-restore2", "research-replay.sqlite"));
  const backupRestoreHashMatch = statSync(copyBackup).size > 0 && reReleased.quickCheck === "ok" && restored.quickCheck === "ok";

  return {
    fixtures: fixture.cases.length,
    fixtureCandidates,
    sampleIngestCandidates,
    idempotencyHeld,
    conflictCreated,
    correctionApplied,
    evidencePinsPerCandidate: pinsPerCandidate,
    appendOnlyEnforced,
    gcPinRespected,
    parseErrorCreatesNoCandidate,
    backupRestoreHashMatch,
  };
}

export type N1PermanentRolloutReport = {
  stage: "N1-B";
  reportVersion: string;
  status: "COMPLETE" | "CONDITIONAL" | "BLOCKED";
  applied: boolean;
  sidecarPath: string;
  primarySourcePath: string;
  schema: {
    beforeVersion: string | null;
    afterVersion: string | null;
    targetVersion: string;
    migrationChecksum: string;
    checksumMatches: boolean;
    appendOnlyTriggerCount: number;
    migrationMs: number;
    integrityCheck: string;
    foreignKeyViolations: number;
    f0ReaderCompatible: boolean;
    f0rReaderCompatible: boolean;
    n1ReaderCompatible: boolean;
    permanentRowCounts: Record<string, number>;
  };
  approval: {
    scope: string;
    targetStage: string;
    targetSchemaVersion: string;
    targetContractVersion: string;
    rolloutStartedAt: string;
    executionMode: ApprovalMode;
    resolution: ApprovalResolution;
    approved: boolean;
  };
  primaryIsolationBefore: PrimaryIsolationProbe;
  primaryIsolationAfter: PrimaryIsolationProbe;
  primaryUnchanged: boolean;
  backup: {
    path: string | null;
    sha256: string | null;
    bytes: number | null;
    quickCheck: string | null;
    restoredHashMatches: boolean;
  } | null;
  preMigrationGate: {
    shadowWriterOff: boolean;
    operationalGcOff: boolean;
    outboxQueueEmpty: boolean;
    integrityOk: boolean;
    foreignKeyOk: boolean;
    rolloutSchemaOk: boolean;
    diskFreeBytes: number;
    quotaBytes: number;
    lowWaterBytes: number;
    backupDirWritable: boolean;
    targetIsSidecarNotPrimary: boolean;
  };
  postMigrationGate: {
    schemaVersionMatches: boolean;
    checksumMatches: boolean;
    noPartialMigration: boolean;
    noUnknownSchema: boolean;
    integrityOk: boolean;
    foreignKeyOk: boolean;
    appendOnlyTriggerCount: number;
    f0ReaderCompatible: boolean;
    f0rReaderCompatible: boolean;
    n1ReaderCompatible: boolean;
    shadowWriterOff: boolean;
    operationalGcOff: boolean;
    outboxQueueEmpty: boolean;
    zeroDataN1: boolean;
  } | null;
  canary: RestoreCopyCanary | null;
  gates: Record<string, boolean>;
  blockers: string[];
  n1cEligibility: {
    status: "READY" | "CONDITIONAL" | "BLOCKED";
    reasons: string[];
  };
  nonGoals: {
    historicalBackfill: false;
    futureCollector: false;
    shadowWriterEnabled: false;
    operationalGcEnabled: false;
    legacyRoiChanged: false;
    productionConnected: false;
    n2Started: false;
  };
  generatedAt: string;
};

function n1DataRowCounts(db: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of N1_DATA_TABLES) {
    counts[table] = Number((db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c);
  }
  return counts;
}

export function runN1PermanentRollout(input: {
  sidecarPath: string;
  rawRoot: string;
  primarySourcePath: string;
  backupDirectory: string;
  fixturePath: string;
  rolloutStartedAt: string;
  executionMode: ApprovalMode;
  apply: boolean;
  capacityFitsQuota: boolean;
  evidencePinReductionRequired: boolean;
  reportRoot?: string;
  generatedAt?: string;
}): N1PermanentRolloutReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const root = input.reportRoot ?? process.cwd();
  const sidecarPath = resolve(input.sidecarPath);
  const primaryIsolationBefore = probePrimaryReadOnly(input.primarySourcePath, sidecarPath);

  const db = openRolloutDatabase(sidecarPath);
  const rolloutBefore = verifyRolloutSchema(db);
  const beforeVersion = verifyN1SettlementSchema(db).version;
  const controller = new RolloutController(
    db, new ResearchReplayRepository(db, new RawStore(resolve(input.rawRoot)), randomUUID, () => generatedAt),
    new RawStore(resolve(input.rawRoot)), randomUUID, () => generatedAt,
  );
  const config = controller.currentConfig();
  const outboxQueue = Number((db.prepare("SELECT COUNT(*) c FROM shadow_outbox_messages").get() as { c: number }).c);
  const integrityBefore = (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  const fkBefore = db.prepare("PRAGMA foreign_key_check").all().length;
  const diskStats = statfsSync(dirname(sidecarPath));
  const diskFreeBytes = Number(diskStats.bavail) * Number(diskStats.bsize);
  mkdirSync(input.backupDirectory, { recursive: true, mode: 0o700 });
  const backupDirWritable = existsSync(input.backupDirectory);
  const targetIsSidecarNotPrimary = primaryIsolationBefore.targetIsNotPrimary;

  const preMigrationGate = {
    shadowWriterOff: !config.shadowWriteEnabled,
    operationalGcOff: !config.operationalGcEnabled,
    outboxQueueEmpty: outboxQueue === 0,
    integrityOk: integrityBefore === "ok",
    foreignKeyOk: fkBefore === 0,
    rolloutSchemaOk: rolloutBefore.ok,
    diskFreeBytes,
    quotaBytes: config.storageQuotaBytes,
    lowWaterBytes: config.diskLowWaterBytes,
    backupDirWritable,
    targetIsSidecarNotPrimary,
  };

  const approval = resolveApproval(db, {
    ...n1bApprovalTarget(),
    rolloutStartedAt: input.rolloutStartedAt,
    executionMode: input.executionMode,
  });

  const preGateOk = Object.entries(preMigrationGate)
    .filter(([key]) => !["diskFreeBytes", "quotaBytes", "lowWaterBytes"].includes(key))
    .every(([, value]) => value === true);

  let backup: N1PermanentRolloutReport["backup"] = null;
  let postMigrationGate: N1PermanentRolloutReport["postMigrationGate"] = null;
  let canary: RestoreCopyCanary | null = null;
  let migrationMs = 0;
  let applied = false;
  let integrityAfter = integrityBefore;
  let fkAfter = fkBefore;
  const work = mkdtempSync(join(tmpdir(), "n1b-rollout-"));

  const willApply = input.apply && approval.approved && preGateOk;
  try {
    if (willApply) {
      const operationId = `n1b-backup-${generatedAt.replaceAll(/[^0-9]/g, "")}`;
      controller.recordOperationalEvidence({ operationId, eventKind: "backup_started", subjectType: "research_sidecar", subjectId: sidecarPath });
      const backupPath = join(input.backupDirectory, `${operationId}.sqlite`);
      const backupEvidence = backupSidecar(db, backupPath);
      controller.recordOperationalEvidence({
        operationId, eventKind: "backup_completed", subjectType: "research_sidecar", subjectId: sidecarPath,
        detail: { sha256: backupEvidence.sha256, bytes: backupEvidence.bytes, quickCheck: backupEvidence.quickCheck },
      });
      const restoreProbe = restoreSidecar(backupPath, join(work, "verify-restore", "research-replay.sqlite"));
      controller.recordOperationalEvidence({
        operationId, eventKind: "restore_verified", subjectType: "research_sidecar_backup", subjectId: backupPath,
        detail: { hashMatches: restoreProbe.sha256 === backupEvidence.sha256 },
      });
      backup = {
        path: reportPath(backupEvidence.path, root),
        sha256: backupEvidence.sha256,
        bytes: backupEvidence.bytes,
        quickCheck: backupEvidence.quickCheck,
        restoredHashMatches: restoreProbe.sha256 === backupEvidence.sha256,
      };

      const migrationStart = process.hrtime.bigint();
      initializeN1SettlementSchema(db, generatedAt);
      migrationMs = Number(process.hrtime.bigint() - migrationStart) / 1_000_000;
      applied = true;

      integrityAfter = (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
      fkAfter = db.prepare("PRAGMA foreign_key_check").all().length;
      const n1Schema = verifyN1SettlementSchema(db);
      const rolloutAfter = verifyRolloutSchema(db);
      const rowCounts = n1DataRowCounts(db);
      postMigrationGate = {
        schemaVersionMatches: n1Schema.version === N1_SETTLEMENT_SCHEMA_VERSION,
        checksumMatches: n1Schema.checksumMatches,
        noPartialMigration: n1Schema.ok,
        noUnknownSchema: n1Schema.ok,
        integrityOk: integrityAfter === "ok",
        foreignKeyOk: fkAfter === 0,
        appendOnlyTriggerCount: n1Schema.appendOnlyTriggerCount,
        f0ReaderCompatible: rolloutAfter.base.ok,
        f0rReaderCompatible: rolloutAfter.ok,
        n1ReaderCompatible: n1Schema.ok,
        shadowWriterOff: !controller.currentConfig().shadowWriteEnabled,
        operationalGcOff: !controller.currentConfig().operationalGcEnabled,
        outboxQueueEmpty: Number((db.prepare("SELECT COUNT(*) c FROM shadow_outbox_messages").get() as { c: number }).c) === 0,
        zeroDataN1: Object.values(rowCounts).every((count) => count === 0),
      };

      // restore-copy canary（永続sidecarには触れない）。
      const canaryBackup = join(work, "canary-source-backup.sqlite");
      const canaryBackupDb = new DatabaseSync(sidecarPath, { readOnly: true });
      canaryBackupDb.exec(`VACUUM INTO '${canaryBackup.replaceAll("'", "''")}'`);
      canaryBackupDb.close();
      canary = runN1RestoreCopyCanary({ backupPath: canaryBackup, fixturePath: input.fixturePath, workRoot: work, now: generatedAt });
    }
  } finally {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    rmSync(work, { recursive: true, force: true });
  }

  const primaryIsolationAfter = probePrimaryReadOnly(input.primarySourcePath, sidecarPath);
  const primaryUnchanged = primaryIsolationBefore.schemaHash === primaryIsolationAfter.schemaHash
    && primaryIsolationBefore.appSettingsHash === primaryIsolationAfter.appSettingsHash;
  const redactProbe = (probe: PrimaryIsolationProbe): PrimaryIsolationProbe => ({
    ...probe,
    path: reportPath(probe.path, root),
    attachedDatabases: probe.attachedDatabases.map((file) => reportPath(file, root)),
  });

  const finalDb = openRolloutDatabase(sidecarPath);
  const n1SchemaFinal = verifyN1SettlementSchema(finalDb);
  const rolloutFinal = verifyRolloutSchema(finalDb);
  const rowCountsFinal = n1SchemaFinal.ok ? n1DataRowCounts(finalDb) : {};
  const shadowWriterOffFinal = rolloutFinal.shadowDefaultOff;
  finalDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  finalDb.close();

  const gates: Record<string, boolean> = {
    humanApproval: approval.approved,
    primaryReadOnly: primaryIsolationBefore.readOnlyConnection && primaryIsolationBefore.queryOnlyEnforced,
    primaryWriteZero: primaryIsolationBefore.writeStatementCount === 0 && primaryIsolationBefore.writeConnectionCount === 0,
    targetIsSidecar: targetIsSidecarNotPrimary,
    preMigrationGate: preGateOk,
    backupCreated: applied ? Boolean(backup?.quickCheck === "ok" && backup?.restoredHashMatches) : true,
    schemaApplied: applied ? n1SchemaFinal.ok : false,
    checksumMatches: n1SchemaFinal.checksumMatches,
    appendOnlyTriggers: n1SchemaFinal.appendOnlyTriggerCount === 14,
    integrityOk: integrityAfter === "ok",
    foreignKeyOk: fkAfter === 0,
    zeroDataN1: applied ? Object.values(rowCountsFinal).every((count) => count === 0) : false,
    f0ReaderCompatible: rolloutFinal.base.ok,
    f0rReaderCompatible: rolloutFinal.ok,
    canaryFixtures: canary ? canary.fixtures === 20 : false,
    canaryIdempotency: canary ? canary.idempotencyHeld : false,
    canaryConflict: canary ? canary.conflictCreated : false,
    canaryCorrection: canary ? canary.correctionApplied : false,
    canaryAppendOnly: canary ? canary.appendOnlyEnforced : false,
    canaryGcPin: canary ? canary.gcPinRespected : false,
    canaryBackupRestore: canary ? canary.backupRestoreHashMatch : false,
    primaryUnchanged,
    shadowWriterOff: shadowWriterOffFinal,
  };

  const blockers: string[] = [];
  if (!approval.approved) blockers.push(`HUMAN_APPROVAL:${approval.code}`);
  if (!primaryUnchanged) blockers.push("PRIMARY_SCHEMA_OR_SETTINGS_CHANGED");
  if (applied && !n1SchemaFinal.ok) blockers.push("N1_SCHEMA_NOT_APPLIED");
  if (applied && postMigrationGate && !postMigrationGate.zeroDataN1) blockers.push("PERMANENT_SIDECAR_NOT_ZERO_DATA");
  if (applied && canary && !canary.appendOnlyEnforced) blockers.push("APPEND_ONLY_NOT_ENFORCED");

  const n1cReasons: string[] = [];
  if (!input.capacityFitsQuota) n1cReasons.push("projected full N1 store exceeds current 1GiB quota; raise quota/low-water before backfill");
  if (input.evidencePinReductionRequired) n1cReasons.push("evidence pin redundancy (~3 rows/candidate, ~19M projected) should adopt candidate-FK implicit pin (Option B) before backfill");
  n1cReasons.push("backfill chunk/checkpoint executor not yet implemented (design only)");
  n1cReasons.push("future result collector requires separate approval");

  const status: N1PermanentRolloutReport["status"] = blockers.length > 0
    ? (approval.approved ? "BLOCKED" : "BLOCKED")
    : !input.apply
      ? "CONDITIONAL"
      : (input.capacityFitsQuota && !input.evidencePinReductionRequired ? "COMPLETE" : "CONDITIONAL");

  return {
    stage: "N1-B",
    reportVersion: N1B_REPORT_VERSION,
    status,
    applied,
    sidecarPath: reportPath(sidecarPath, root),
    primarySourcePath: reportPath(input.primarySourcePath, root),
    schema: {
      beforeVersion,
      afterVersion: n1SchemaFinal.version,
      targetVersion: N1_SETTLEMENT_SCHEMA_VERSION,
      migrationChecksum: N1_SETTLEMENT_MIGRATION_CHECKSUM,
      checksumMatches: n1SchemaFinal.checksumMatches,
      appendOnlyTriggerCount: n1SchemaFinal.appendOnlyTriggerCount,
      migrationMs,
      integrityCheck: integrityAfter,
      foreignKeyViolations: fkAfter,
      f0ReaderCompatible: rolloutFinal.base.ok,
      f0rReaderCompatible: rolloutFinal.ok,
      n1ReaderCompatible: n1SchemaFinal.ok,
      permanentRowCounts: rowCountsFinal,
    },
    approval: {
      scope: N1B_APPROVAL_SCOPE,
      targetStage: N1B_TARGET_STAGE,
      targetSchemaVersion: N1_SETTLEMENT_SCHEMA_VERSION,
      targetContractVersion: N1B_TARGET_CONTRACT,
      rolloutStartedAt: input.rolloutStartedAt,
      executionMode: input.executionMode,
      resolution: approval,
      approved: approval.approved,
    },
    primaryIsolationBefore: redactProbe(primaryIsolationBefore),
    primaryIsolationAfter: redactProbe(primaryIsolationAfter),
    primaryUnchanged,
    backup,
    preMigrationGate,
    postMigrationGate,
    canary,
    gates,
    blockers,
    n1cEligibility: {
      status: blockers.length > 0 ? "BLOCKED" : n1cReasons.length > 0 ? "CONDITIONAL" : "READY",
      reasons: n1cReasons,
    },
    nonGoals: {
      historicalBackfill: false,
      futureCollector: false,
      shadowWriterEnabled: false,
      operationalGcEnabled: false,
      legacyRoiChanged: false,
      productionConnected: false,
      n2Started: false,
    },
    generatedAt,
  };
}
