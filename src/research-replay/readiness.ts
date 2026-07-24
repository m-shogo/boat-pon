import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "./canonical";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import {
  backupSidecar,
  DEFAULT_ROLLOUT_CONFIG,
  restoreSidecar,
  RolloutController,
} from "./rollout";
import {
  F0R_LEDGER_SQL,
  F0R_MIGRATION_CHECKSUM,
  initializeRolloutSchema,
  initializeSidecarSchema,
  openSidecarDatabase,
  openRolloutDatabase,
  ROLLOUT_SCHEMA_VERSION,
  verifyRolloutSchema,
} from "./schema";

export const F0R_REPORT_VERSION = "f0r-readiness-v1";

type SourceFingerprint = {
  exists: boolean;
  schemaHash: string | null;
  appSettingsHash: string | null;
  researchTableCount: number | null;
  sizeBytes: number | null;
  modifiedMs: number | null;
};

export type F0RReadinessReport = {
  stage: "F0-R";
  reportVersion: string;
  status: "COMPLETE" | "BLOCKED";
  rolloutMode: "sidecar_shadow_default_off";
  sidecarPath: string;
  rawRoot: string;
  schemaVersion: string;
  schemaVerification: ReturnType<typeof verifyRolloutSchema>;
  migrationMs: number;
  humanApproval: {
    recorded: boolean;
    source: string;
    scope: string;
  };
  gates: {
    f0Complete: boolean;
    dbCopy: boolean;
    backup: boolean;
    restore: boolean;
    walLockIsolation: boolean;
    crashRecovery: boolean;
    diskCapacity: boolean;
    rollback: boolean;
    collectorNonRegression: boolean;
    oldReaderCompatibility: boolean;
    partialMigrationResume: boolean;
    shadowDefaultOff: boolean;
    primaryFailureIsolation: boolean;
    boundedOutbox: boolean;
    operationalGcAudit: boolean;
  };
  backup: {
    path: string;
    sha256: string;
    bytes: number;
    quickCheck: string;
    restoredHashMatches: boolean;
  };
  disk: {
    freeBytes: number;
    configuredLowWaterBytes: number;
    configuredQuotaBytes: number;
  };
  shadowHealth: ReturnType<RolloutController["health"]>;
  canary: {
    primaryContinuedAfterShadowFailure: boolean;
    outboxReplaySucceeded: boolean;
    unreferencedRawDeleted: boolean;
    rollbackEngagedKillSwitch: boolean;
    crashTransactionRolledBack: boolean;
    walWriterRecovered: boolean;
    partialMigrationResumed: boolean;
  };
  primarySourceBefore: SourceFingerprint;
  primarySourceAfter: SourceFingerprint;
  nonGoals: {
    productionDbWritten: false;
    liveCollectorConnected: false;
    modelImplemented: false;
    buyWatchSkipChanged: false;
    legacyEvaluationMixed: false;
    n1Started: false;
  };
  nextStage: "N1_REVIEW_REQUIRES_SEPARATE_APPROVAL";
  blockers: string[];
  generatedAt: string;
};

function sourceFingerprint(path: string): SourceFingerprint {
  if (!existsSync(path)) {
    return {
      exists: false,
      schemaHash: null,
      appSettingsHash: null,
      researchTableCount: null,
      sizeBytes: null,
      modifiedMs: null,
    };
  }
  const metadata = statSync(path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const schemaRows = db.prepare(`
      SELECT type, name, sql
      FROM sqlite_master
      WHERE sql IS NOT NULL
      ORDER BY type, name
    `).all();
    const hasSettings = Boolean(db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_settings'
    `).get());
    const appSettings = hasSettings
      ? db.prepare("SELECT * FROM app_settings ORDER BY rowid").all()
      : [];
    const researchTableCount = Number((db.prepare(`
      SELECT COUNT(*) count FROM sqlite_master
      WHERE type='table' AND name LIKE 'research_%'
    `).get() as { count: number }).count);
    return {
      exists: true,
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

function reportMarkdown(report: F0RReadinessReport): string {
  const gates = Object.entries(report.gates)
    .map(([name, passed]) => `- ${name}: ${passed ? "PASS" : "FAIL"}`)
    .join("\n");
  return `# Stage F0-R Research Replay Foundation Rollout

- Status: **${report.status}**
- Rollout mode: \`${report.rolloutMode}\`
- Sidecar schema: \`${report.schemaVersion}\`
- Shadow write: **OFF**
- N1: **NOT STARTED**

## Gates

${gates}

## Deployment boundary

- Research evidenceは独立sidecarへ配置した。
- \`data/boat.sqlite\`はread-only fingerprint監査だけを行った。
- live collector、Legacy formal、BUY/WATCH/SKIP、通知、モデルへ接続していない。
- sidecar writerとoperational GCはdefault OFFである。

## Backup / restore

- quick_check: \`${report.backup.quickCheck}\`
- backup bytes: ${report.backup.bytes}
- backup/restore hash match: ${report.backup.restoredHashMatches}

## Failure isolation canary

- primary continued: ${report.canary.primaryContinuedAfterShadowFailure}
- outbox replay: ${report.canary.outboxReplaySucceeded}
- GC audited deletion: ${report.canary.unreferencedRawDeleted}
- rollback kill switch: ${report.canary.rollbackEngagedKillSwitch}
- crash transaction rollback: ${report.canary.crashTransactionRolledBack}
- WAL writer recovery: ${report.canary.walWriterRecovered}
- partial migration resume: ${report.canary.partialMigrationResumed}

## Next

N1は自動開始しない。schema/migration再レビューと別の明示承認を待つ。
`;
}

function runRestoredCanary(restoredPath: string, tempRoot: string, now: string): F0RReadinessReport["canary"] {
  const crashId = "f0r-crash-uncommitted";
  const crashDb = openRolloutDatabase(restoredPath);
  crashDb.exec("BEGIN IMMEDIATE");
  crashDb.prepare(`
    INSERT INTO rollout_approval_events
    (approval_event_id, approval_scope, approval_source, approved_at, recorded_at, detail_json)
    VALUES (?, 'CRASH_CANARY', 'local_fixture', ?, ?, '{}')
  `).run(crashId, now, now);
  crashDb.close();
  const afterCrash = openRolloutDatabase(restoredPath);
  const crashTransactionRolledBack = !(afterCrash.prepare(`
    SELECT 1 FROM rollout_approval_events WHERE approval_event_id=?
  `).get(crashId));

  const lockPeer = openRolloutDatabase(restoredPath);
  lockPeer.exec("PRAGMA busy_timeout=20");
  afterCrash.exec("BEGIN IMMEDIATE");
  let lockRejected = false;
  try {
    lockPeer.exec("BEGIN IMMEDIATE");
  } catch {
    lockRejected = true;
  }
  afterCrash.exec("ROLLBACK");
  lockPeer.exec("BEGIN IMMEDIATE; ROLLBACK");
  const walWriterRecovered = lockRejected;
  lockPeer.close();

  const partialPath = join(tempRoot, "partial-resume.sqlite");
  const partialDb = openSidecarDatabase(partialPath);
  initializeSidecarSchema(partialDb, now);
  partialDb.exec(F0R_LEDGER_SQL);
  partialDb.prepare(`
    INSERT INTO rollout_schema_migrations
    (migration_id, migration_version, checksum, applied_at, runtime_version, status)
    VALUES ('readiness-partial', ?, ?, ?, ?, 'partial')
  `).run(ROLLOUT_SCHEMA_VERSION, F0R_MIGRATION_CHECKSUM, now, process.version);
  initializeRolloutSchema(partialDb, now);
  const partialMigrationResumed = verifyRolloutSchema(partialDb).ok;
  partialDb.close();

  const rawStore = new RawStore(join(tempRoot, "canary-raw"));
  let sequence = 0;
  let canaryNow = new Date(new Date(now).getTime() + 1000).toISOString();
  const repository = new ResearchReplayRepository(
    afterCrash,
    rawStore,
    () => `readiness-${++sequence}`,
    () => canaryNow,
  );
  const controller = new RolloutController(
    afterCrash,
    repository,
    rawStore,
    () => `readiness-${++sequence}`,
    () => canaryNow,
    () => Number.MAX_SAFE_INTEGER,
  );
  controller.recordConfig({
    ...DEFAULT_ROLLOUT_CONFIG,
    shadowWriteEnabled: true,
    operationalGcEnabled: true,
    queueCapacity: 2,
    maxRetries: 1,
    storageQuotaBytes: 1024 * 1024,
    diskLowWaterBytes: 0,
  }, "F0-R isolated restored-copy canary", canaryNow);
  let primaryCount = 0;
  const isolated = controller.runPrimaryWithOptionalShadow(
    () => ++primaryCount,
    () => {
      throw new Error("intentional shadow failure");
    },
  );
  const queued = controller.enqueue({
    idempotencyKey: "f0r-readiness-canary",
    messageType: "sanitized_fixture",
    payload: { fixture: true },
  });
  const replay = controller.drain(() => undefined);
  const raw = repository.recordRawDocument({
    bytes: Buffer.from("f0r-gc-canary", "utf8"),
    contentType: "text/plain",
    charset: "utf-8",
  });
  controller.recordConfig({
    ...controller.currentConfig(),
    storageQuotaBytes: 1,
  }, "F0-R isolated restored-copy GC pressure", canaryNow);
  const gc = controller.collectUnreferencedRaw();
  const rolledBack = controller.rollback("F0-R canary complete");
  afterCrash.close();
  return {
    primaryContinuedAfterShadowFailure: isolated.primaryResult === 1
      && !isolated.shadowSucceeded
      && primaryCount === 1,
    outboxReplaySucceeded: queued.status === "enqueued" && replay.succeeded === 1,
    unreferencedRawDeleted: gc.deleted.includes(raw.rawDocumentId)
      && !existsSync(rawStore.absolutePathForHash(raw.rawSha256)),
    rollbackEngagedKillSwitch: !rolledBack.shadowWriteEnabled && rolledBack.killSwitchEngaged,
    crashTransactionRolledBack,
    walWriterRecovered,
    partialMigrationResumed,
  };
}

export function runF0RReadiness(input: {
  sidecarPath: string;
  rawRoot: string;
  primarySourcePath: string;
  backupDirectory: string;
  approvalSource: string;
  approvedAt?: string;
}): F0RReadinessReport {
  const generatedAt = input.approvedAt ?? new Date().toISOString();
  const sidecarPath = resolve(input.sidecarPath);
  const rawRoot = resolve(input.rawRoot);
  const primarySourceBefore = sourceFingerprint(input.primarySourcePath);
  mkdirSync(dirname(sidecarPath), { recursive: true, mode: 0o700 });
  const migrationStarted = process.hrtime.bigint();
  const db = openRolloutDatabase(sidecarPath);
  initializeRolloutSchema(db, generatedAt);
  const migrationMs = Number(process.hrtime.bigint() - migrationStarted) / 1_000_000;
  const rawStore = new RawStore(rawRoot);
  const repository = new ResearchReplayRepository(
    db,
    rawStore,
    randomUUID,
    () => generatedAt,
  );
  const controller = new RolloutController(
    db,
    repository,
    rawStore,
    randomUUID,
    () => generatedAt,
  );
  const approvalExists = Boolean(db.prepare(`
    SELECT 1 FROM rollout_approval_events WHERE approval_event_id='f0r-start-approval-v1'
  `).get());
  if (!approvalExists) {
    controller.recordApproval({
      approvalEventId: "f0r-start-approval-v1",
      approvalScope: "F0-R_START_AND_SIDECAR_ROLLOUT",
      approvalSource: input.approvalSource,
      approvedAt: generatedAt,
      detail: { productionDbWrite: false, liveShadowWrite: false },
    });
  }
  const configExists = Boolean(db.prepare(`
    SELECT 1 FROM rollout_config_events WHERE config_event_id='f0r-default-off-v1'
  `).get());
  if (!configExists) {
    controller.recordConfig(
      DEFAULT_ROLLOUT_CONFIG,
      "F0-R rollout default OFF",
      generatedAt,
      "f0r-default-off-v1",
    );
  }
  const operationId = `backup-${generatedAt.replaceAll(/[^0-9]/g, "")}`;
  mkdirSync(input.backupDirectory, { recursive: true, mode: 0o700 });
  const backupPath = join(input.backupDirectory, `${operationId}.sqlite`);
  controller.recordOperationalEvidence({
    operationId,
    eventKind: "backup_started",
    subjectType: "research_sidecar",
    subjectId: sidecarPath,
  });
  const backup = backupSidecar(db, backupPath);
  controller.recordOperationalEvidence({
    operationId,
    eventKind: "backup_completed",
    subjectType: "research_sidecar",
    subjectId: sidecarPath,
    detail: { sha256: backup.sha256, bytes: backup.bytes, quickCheck: backup.quickCheck },
  });
  const tempRoot = mkdtempSync(join(tmpdir(), "boat-pon-f0r-readiness-"));
  let restoredHashMatches = false;
  let canary: F0RReadinessReport["canary"];
  try {
    const restorePath = join(tempRoot, "restore", "research-replay.sqlite");
    const restored = restoreSidecar(backupPath, restorePath);
    restoredHashMatches = restored.sha256 === backup.sha256;
    controller.recordOperationalEvidence({
      operationId,
      eventKind: "restore_verified",
      subjectType: "research_sidecar_backup",
      subjectId: backupPath,
      detail: { hashMatches: restoredHashMatches, quickCheck: restored.quickCheck },
    });
    canary = runRestoredCanary(restorePath, tempRoot, generatedAt);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  const health = controller.recordHealthSnapshot();
  const rolloutSchema = verifyRolloutSchema(db);
  const diskStats = statfsSync(dirname(sidecarPath));
  const diskFreeBytes = Number(diskStats.bavail) * Number(diskStats.bsize);
  db.close();
  const primarySourceAfter = sourceFingerprint(input.primarySourcePath);
  const collectorNonRegression = primarySourceBefore.schemaHash === primarySourceAfter.schemaHash
    && primarySourceBefore.appSettingsHash === primarySourceAfter.appSettingsHash
    && primarySourceAfter.researchTableCount === 0;
  const gates = {
    f0Complete: rolloutSchema.base.ok,
    dbCopy: backup.quickCheck === "ok",
    backup: backup.schemaOk && backup.quickCheck === "ok",
    restore: restoredHashMatches,
    walLockIsolation: canary.walWriterRecovered,
    crashRecovery: canary.crashTransactionRolledBack,
    diskCapacity: diskFreeBytes > health.config.diskLowWaterBytes,
    rollback: canary.rollbackEngagedKillSwitch,
    collectorNonRegression,
    oldReaderCompatibility: rolloutSchema.oldReaderCompatible,
    partialMigrationResume: canary.partialMigrationResumed,
    shadowDefaultOff: !health.config.shadowWriteEnabled,
    primaryFailureIsolation: canary.primaryContinuedAfterShadowFailure,
    boundedOutbox: canary.outboxReplaySucceeded,
    operationalGcAudit: canary.unreferencedRawDeleted,
  };
  const blockers = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return {
    stage: "F0-R",
    reportVersion: F0R_REPORT_VERSION,
    status: blockers.length === 0 ? "COMPLETE" : "BLOCKED",
    rolloutMode: "sidecar_shadow_default_off",
    sidecarPath,
    rawRoot,
    schemaVersion: ROLLOUT_SCHEMA_VERSION,
    schemaVerification: rolloutSchema,
    migrationMs,
    humanApproval: {
      recorded: true,
      source: input.approvalSource,
      scope: "F0-R_START_AND_SIDECAR_ROLLOUT",
    },
    gates,
    backup: {
      path: backup.path,
      sha256: backup.sha256,
      bytes: backup.bytes,
      quickCheck: backup.quickCheck,
      restoredHashMatches,
    },
    disk: {
      freeBytes: diskFreeBytes,
      configuredLowWaterBytes: health.config.diskLowWaterBytes,
      configuredQuotaBytes: health.config.storageQuotaBytes,
    },
    shadowHealth: health,
    canary,
    primarySourceBefore,
    primarySourceAfter,
    nonGoals: {
      productionDbWritten: false,
      liveCollectorConnected: false,
      modelImplemented: false,
      buyWatchSkipChanged: false,
      legacyEvaluationMixed: false,
      n1Started: false,
    },
    nextStage: "N1_REVIEW_REQUIRES_SEPARATE_APPROVAL",
    blockers,
    generatedAt,
  };
}

export function writeF0RReadinessReports(
  report: F0RReadinessReport,
  root = process.cwd(),
): { jsonPath: string; markdownPath: string } {
  const reports = join(root, "reports");
  mkdirSync(reports, { recursive: true });
  const jsonPath = join(reports, "research-replay-rollout-readiness.json");
  const markdownPath = join(reports, "research-replay-rollout-readiness.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, reportMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}
