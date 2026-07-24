import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RawStore } from "./rawStore";
import { runF0RReadiness } from "./readiness";
import { ResearchReplayRepository } from "./repository";
import {
  backupSidecar,
  DEFAULT_ROLLOUT_CONFIG,
  restoreSidecar,
  RolloutController,
  type RolloutConfig,
} from "./rollout";
import {
  F0R_MIGRATION_CHECKSUM,
  F0R_LEDGER_SQL,
  initializeRolloutSchema,
  initializeSidecarSchema,
  openRolloutDatabase,
  openSidecarDatabase,
  ROLLOUT_SCHEMA_VERSION,
  verifyRolloutSchema,
  verifySidecarSchema,
} from "./schema";

type RolloutContext = {
  root: string;
  dbPath: string;
  db: DatabaseSync;
  rawStore: RawStore;
  repository: ResearchReplayRepository;
  controller: RolloutController;
  setNow(value: string): void;
  close(): void;
};

function rolloutContext(diskFreeBytes = Number.MAX_SAFE_INTEGER): RolloutContext {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0r-test-"));
  const dbPath = join(root, "research-replay.sqlite");
  const db = openRolloutDatabase(dbPath);
  initializeRolloutSchema(db, "2026-07-24T02:00:00.000Z");
  const rawStore = new RawStore(join(root, "raw"));
  let sequence = 0;
  let now = "2026-07-24T02:00:00.000Z";
  const repository = new ResearchReplayRepository(
    db,
    rawStore,
    () => `f0r-${++sequence}`,
    () => now,
  );
  const controller = new RolloutController(
    db,
    repository,
    rawStore,
    () => `f0r-${++sequence}`,
    () => now,
    () => diskFreeBytes,
  );
  return {
    root,
    dbPath,
    db,
    rawStore,
    repository,
    controller,
    setNow(value: string) {
      now = value;
    },
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function enabledConfig(overrides: Partial<RolloutConfig> = {}): RolloutConfig {
  return {
    ...DEFAULT_ROLLOUT_CONFIG,
    shadowWriteEnabled: true,
    storageQuotaBytes: 1024 * 1024,
    diskLowWaterBytes: 0,
    ...overrides,
  };
}

test("F0-R migrationはexpand-onlyでold reader互換・shadow default OFF", (t) => {
  const ctx = rolloutContext();
  t.after(() => ctx.close());
  const rollout = verifyRolloutSchema(ctx.db);
  assert.equal(rollout.ok, true);
  assert.equal(rollout.oldReaderCompatible, true);
  assert.equal(rollout.shadowDefaultOff, true);
  assert.equal(verifySidecarSchema(ctx.db).ok, true);
  const legacyReaderView = ctx.db.prepare(`
    SELECT migration_version FROM research_schema_migrations
    ORDER BY applied_at DESC LIMIT 1
  `).get() as { migration_version: string };
  assert.equal(legacyReaderView.migration_version, "f0.1.0");
  assert.equal((ctx.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 100);
  assert.equal(ctx.controller.currentConfig().shadowWriteEnabled, false);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) count FROM capture_attempts").get() as { count: number }).count, 0);
});

test("partial migrationはchecksum一致時だけresumeする", (t) => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0r-resume-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const db = openSidecarDatabase(join(root, "resume.sqlite"));
  t.after(() => db.close());
  initializeSidecarSchema(db, "2026-07-24T02:00:00.000Z");
  db.exec(F0R_LEDGER_SQL);
  db.prepare(`
    INSERT INTO rollout_schema_migrations
    (migration_id, migration_version, checksum, applied_at, runtime_version, status)
    VALUES ('partial-f0r', ?, ?, '2026-07-24T02:00:01.000Z', ?, 'partial')
  `).run(ROLLOUT_SCHEMA_VERSION, F0R_MIGRATION_CHECKSUM, process.version);
  initializeRolloutSchema(db, "2026-07-24T02:00:02.000Z");
  assert.equal(verifyRolloutSchema(db).ok, true);

  const bad = openSidecarDatabase(join(root, "bad.sqlite"));
  t.after(() => bad.close());
  initializeSidecarSchema(bad, "2026-07-24T02:00:00.000Z");
  bad.exec(F0R_LEDGER_SQL);
  bad.prepare(`
    INSERT INTO rollout_schema_migrations
    (migration_id, migration_version, checksum, applied_at, runtime_version, status)
    VALUES ('partial-bad', ?, 'bad', '2026-07-24T02:00:01.000Z', ?, 'partial')
  `).run(ROLLOUT_SCHEMA_VERSION, process.version);
  assert.throws(() => initializeRolloutSchema(bad), /checksum mismatch/);
});

test("approval/configはappend-onlyでdefault OFFを明示的に維持する", (t) => {
  const ctx = rolloutContext();
  t.after(() => ctx.close());
  const approval = ctx.controller.recordApproval({
    approvalScope: "F0-R_START",
    approvalSource: "user_message",
    approvedAt: "2026-07-24T02:00:00.000Z",
    detail: { phrase: "進めて" },
  });
  const config = ctx.controller.recordConfig(DEFAULT_ROLLOUT_CONFIG, "rollout default OFF");
  assert.equal(ctx.controller.currentConfig().shadowWriteEnabled, false);
  assert.throws(() => ctx.db.prepare(
    "UPDATE rollout_approval_events SET approval_scope='changed' WHERE approval_event_id=?",
  ).run(approval), /append-only/);
  assert.throws(() => ctx.db.prepare(
    "DELETE FROM rollout_config_events WHERE config_event_id=?",
  ).run(config), /append-only/);
});

test("shadow failureはprimaryへ伝播せずdefault OFFでは試行しない", (t) => {
  const ctx = rolloutContext();
  t.after(() => ctx.close());
  let primaryCount = 0;
  let shadowCount = 0;
  const off = ctx.controller.runPrimaryWithOptionalShadow(
    () => ++primaryCount,
    () => {
      shadowCount += 1;
      throw new Error("shadow down");
    },
  );
  assert.equal(off.primaryResult, 1);
  assert.equal(off.shadowAttempted, false);
  ctx.controller.recordConfig(enabledConfig(), "test-only enable");
  const failed = ctx.controller.runPrimaryWithOptionalShadow(
    () => ++primaryCount,
    () => {
      shadowCount += 1;
      throw new Error("shadow down");
    },
  );
  assert.equal(failed.primaryResult, 2);
  assert.equal(failed.shadowSucceeded, false);
  assert.equal(primaryCount, 2);
  assert.equal(shadowCount, 1);
});

test("outboxはidempotency・retry・backpressure・payload securityを守る", (t) => {
  const ctx = rolloutContext();
  t.after(() => ctx.close());
  assert.equal(ctx.controller.enqueue({
    idempotencyKey: "disabled",
    messageType: "capture",
    payload: { race: "2026-07-24:01:R1" },
  }).status, "disabled");
  ctx.controller.recordConfig(enabledConfig({ queueCapacity: 1, maxRetries: 1 }), "test-only enable");
  assert.throws(() => ctx.controller.enqueue({
    idempotencyKey: "secret",
    messageType: "capture",
    payload: { authorizationToken: "do-not-store" },
  }), /sensitive/);
  const first = ctx.controller.enqueue({
    idempotencyKey: "capture-1",
    messageType: "capture",
    payload: { race: "2026-07-24:01:R1" },
  });
  assert.equal(first.status, "enqueued");
  assert.equal(ctx.controller.enqueue({
    idempotencyKey: "capture-1",
    messageType: "capture",
    payload: { race: "2026-07-24:01:R1" },
  }).status, "existing");
  assert.equal(ctx.controller.enqueue({
    idempotencyKey: "capture-2",
    messageType: "capture",
    payload: { race: "2026-07-24:01:R2" },
  }).status, "backpressure");
  assert.equal(ctx.controller.drain(() => {
    throw new Error("temporary");
  }).retrying, 1);
  ctx.setNow("2026-07-24T02:00:02.000Z");
  assert.equal(ctx.controller.drain(() => undefined).succeeded, 1);
  assert.equal(ctx.controller.health().succeeded, 1);
});

test("disk/quota kill switchとrollbackは新規shadow writeを停止する", (t) => {
  const lowDisk = rolloutContext(10);
  t.after(() => lowDisk.close());
  lowDisk.controller.recordConfig(enabledConfig({ diskLowWaterBytes: 11 }), "force low disk");
  assert.equal(lowDisk.controller.enqueue({
    idempotencyKey: "disk-low",
    messageType: "capture",
    payload: {},
  }).status, "disk_low");
  const stopped = lowDisk.controller.rollback("operator test");
  assert.equal(stopped.shadowWriteEnabled, false);
  assert.equal(stopped.killSwitchEngaged, true);
  assert.equal(lowDisk.controller.enqueue({
    idempotencyKey: "after-rollback",
    messageType: "capture",
    payload: {},
  }).status, "disabled");
});

test("operational GCは完全未参照rawだけをtombstone付きで削除する", (t) => {
  const ctx = rolloutContext();
  t.after(() => ctx.close());
  const removable = ctx.repository.recordRawDocument({
    bytes: Buffer.from("removable"),
    contentType: "text/plain",
    charset: "utf-8",
  });
  const retained = ctx.repository.recordRawDocument({
    bytes: Buffer.from("retained"),
    contentType: "text/plain",
    charset: "utf-8",
  });
  const attempt = ctx.repository.createCaptureAttempt({
    logicalRequestGroupId: "retained",
    sourceUrl: "https://fixture.invalid/retained",
    method: "LOCAL_FIXTURE",
    requestStartedAt: "2026-07-24T02:00:00.000Z",
    sourceType: "sanitized_fixture",
  });
  const completed = ctx.repository.addCaptureEvent({
    captureAttemptId: attempt,
    eventKind: "body_completed",
    occurredAt: "2026-07-24T02:00:00.000Z",
    byteCount: 8,
  });
  ctx.repository.linkCaptureToRaw({
    captureAttemptId: attempt,
    rawDocumentId: retained.rawDocumentId,
    bodyCompletedEventId: completed,
    linkedAt: "2026-07-24T02:00:00.000Z",
  });
  ctx.controller.recordConfig(enabledConfig({
    operationalGcEnabled: true,
    storageQuotaBytes: 1,
  }), "force GC");
  const result = ctx.controller.collectUnreferencedRaw();
  assert.deepEqual(result.deleted, [removable.rawDocumentId]);
  assert.equal(existsSync(ctx.rawStore.absolutePathForHash(removable.rawSha256)), false);
  assert.equal(existsSync(ctx.rawStore.absolutePathForHash(retained.rawSha256)), true);
  assert.equal(ctx.repository.auditRawCache().integrityErrorCount, 0);
});

test("中断したGC intentは再実行可能でauditへrecoveredを追記する", (t) => {
  const ctx = rolloutContext();
  t.after(() => ctx.close());
  const raw = ctx.repository.recordRawDocument({
    bytes: Buffer.from("crash"),
    contentType: "text/plain",
    charset: "utf-8",
  });
  ctx.db.prepare(`
    INSERT INTO operational_audit_events
    (audit_event_id, operation_id, event_kind, subject_type, subject_id,
     detail_json, occurred_at, created_at)
    VALUES ('intent-event', 'gc-crash', 'gc_intent', 'raw_document', ?, '{}', ?, ?)
  `).run(raw.rawDocumentId, "2026-07-24T02:00:00.000Z", "2026-07-24T02:00:00.000Z");
  ctx.repository.recordTombstone({
    evidenceType: "raw_document",
    evidenceId: raw.rawDocumentId,
    reason: "operational_gc_unreferenced",
    recordedAt: "2026-07-24T02:00:00.000Z",
  });
  ctx.rawStore.removeVerified(raw.relativePath, raw.rawSha256);
  assert.deepEqual(ctx.controller.recoverGcIntents(), [raw.rawDocumentId]);
  const recovered = ctx.db.prepare(`
    SELECT COUNT(*) count FROM operational_audit_events
    WHERE operation_id='gc-crash' AND event_kind='gc_recovered'
  `).get() as { count: number };
  assert.equal(recovered.count, 1);
});

test("WAL lock競合はprimary DBと無関係なsidecar内でboundedに失敗・回復する", (t) => {
  const ctx = rolloutContext();
  t.after(() => ctx.close());
  const second = openRolloutDatabase(ctx.dbPath);
  t.after(() => second.close());
  second.exec("PRAGMA busy_timeout=20");
  ctx.db.exec("BEGIN IMMEDIATE");
  assert.throws(() => second.prepare(`
    INSERT INTO rollout_config_events
    (config_event_id, shadow_write_enabled, operational_gc_enabled, kill_switch_engaged,
     queue_capacity, max_retries, storage_quota_bytes, disk_low_water_bytes,
     reason, occurred_at, recorded_at)
    VALUES ('locked', 0, 0, 0, 10, 1, 1000, 0, 'lock', ?, ?)
  `).run("2026-07-24T02:00:00.000Z", "2026-07-24T02:00:00.000Z"), /locked/);
  ctx.db.exec("ROLLBACK");
  second.prepare(`
    INSERT INTO rollout_config_events
    (config_event_id, shadow_write_enabled, operational_gc_enabled, kill_switch_engaged,
     queue_capacity, max_retries, storage_quota_bytes, disk_low_water_bytes,
     reason, occurred_at, recorded_at)
    VALUES ('after-lock', 0, 0, 0, 10, 1, 1000, 0, 'lock recovered', ?, ?)
  `).run("2026-07-24T02:00:01.000Z", "2026-07-24T02:00:01.000Z");
});

test("WAL-safe backupを別pathへrestoreしてschema/hashを検証する", (t) => {
  const ctx = rolloutContext();
  t.after(() => ctx.close());
  ctx.controller.recordApproval({
    approvalScope: "F0-R_TEST",
    approvalSource: "fixture",
    approvedAt: "2026-07-24T02:00:00.000Z",
  });
  const backupPath = join(ctx.root, "backup", "research-replay.sqlite");
  const backup = backupSidecar(ctx.db, backupPath);
  assert.equal(backup.quickCheck, "ok");
  assert.equal(backup.schemaOk, true);
  const restored = restoreSidecar(backupPath, join(ctx.root, "restore", "research-replay.sqlite"));
  assert.equal(restored.quickCheck, "ok");
  assert.equal(restored.schemaOk, true);
  assert.equal(restored.sha256, backup.sha256);
});

test("F0-R readinessは独立sidecarだけで全gateを通しprimary fingerprintを維持する", (t) => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-f0r-readiness-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const primaryPath = join(root, "boat.sqlite");
  const primary = new DatabaseSync(primaryPath);
  primary.exec(`
    CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO app_settings VALUES ('formal_mode', 'unchanged');
    CREATE TABLE decision_history(id INTEGER PRIMARY KEY, decision TEXT);
  `);
  primary.close();
  const report = runF0RReadiness({
    sidecarPath: join(root, "data", "research-replay.sqlite"),
    rawRoot: join(root, "data", "research-replay-raw"),
    primarySourcePath: primaryPath,
    backupDirectory: join(root, "backups"),
    approvalSource: "test_fixture",
    approvedAt: "2026-07-24T02:00:00.000Z",
  });
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.gates.shadowDefaultOff, true);
  assert.equal(report.gates.collectorNonRegression, true);
  assert.equal(report.primarySourceBefore.schemaHash, report.primarySourceAfter.schemaHash);
  assert.equal(report.primarySourceBefore.appSettingsHash, report.primarySourceAfter.appSettingsHash);
  assert.equal(report.nonGoals.productionDbWritten, false);
  assert.equal(report.nextStage, "N1_REVIEW_REQUIRES_SEPARATE_APPROVAL");
});
