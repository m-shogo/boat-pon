import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  statfsSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { verifyRolloutSchema } from "./schema";

export const DEFAULT_ROLLOUT_CONFIG: RolloutConfig = Object.freeze({
  shadowWriteEnabled: false,
  operationalGcEnabled: false,
  killSwitchEngaged: false,
  queueCapacity: 100,
  maxRetries: 3,
  storageQuotaBytes: 1024 * 1024 * 1024,
  diskLowWaterBytes: 2 * 1024 * 1024 * 1024,
});

export type RolloutConfig = {
  shadowWriteEnabled: boolean;
  operationalGcEnabled: boolean;
  killSwitchEngaged: boolean;
  queueCapacity: number;
  maxRetries: number;
  storageQuotaBytes: number;
  diskLowWaterBytes: number;
};

export type EnqueueResult = {
  status: "enqueued" | "existing" | "disabled" | "killed" | "backpressure" | "disk_low" | "quota_exceeded";
  outboxMessageId: string | null;
};

export type ShadowHealth = {
  config: RolloutConfig;
  queued: number;
  succeeded: number;
  retrying: number;
  permanentlyFailed: number;
  oldestQueuedAt: string | null;
  rawStorageBytes: number;
  sidecarBytes: number;
  totalStorageBytes: number;
  diskFreeBytes: number;
  schemaOk: boolean;
};

export type ShadowDrainResult = {
  succeeded: number;
  retrying: number;
  permanentlyFailed: number;
};

export type ShadowDrainDiagnostics = ShadowDrainResult & {
  examined: number;
  contended: number;
  skippedAfterClaim: number;
  handlerDeadlineExceeded: number;
};

export function assertShadowDrainDiagnostics(diagnostics: ShadowDrainDiagnostics): void {
  const counts = Object.values(diagnostics);
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("invalid shadow drain diagnostics");
  }
  const terminalOrRetrying = diagnostics.succeeded
    + diagnostics.retrying
    + diagnostics.permanentlyFailed;
  if (terminalOrRetrying + diagnostics.contended + diagnostics.skippedAfterClaim !== diagnostics.examined) {
    throw new Error("inconsistent shadow drain diagnostics");
  }
  if (diagnostics.handlerDeadlineExceeded > diagnostics.retrying + diagnostics.permanentlyFailed) {
    throw new Error("inconsistent shadow deadline diagnostics");
  }
}

export type ShadowDeliveryContext = {
  deadlineAtMonotonicMs: number;
  remainingMs: () => number;
  throwIfCancelled: () => void;
};

export type ShadowDeliveryHandler = (
  message: {
    outboxMessageId: string;
    messageType: string;
    payload: unknown;
  },
  context: ShadowDeliveryContext,
) => void;

export type ShadowDrainOptions = {
  handlerWallTimeBudgetMs?: number;
};

type IdFactory = () => string;

export class PermanentShadowDeliveryError extends Error {
  readonly permanent = true;

  constructor(errorCode: string, message: string) {
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(errorCode)) {
      throw new Error("invalid permanent shadow delivery error code");
    }
    super(message);
    this.name = errorCode;
  }
}

export class ShadowDeliveryDeadlineExceededError extends Error {
  constructor() {
    super("shadow delivery handler exceeded its wall-time budget");
    this.name = "SHADOW_HANDLER_DEADLINE_EXCEEDED";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function isSqliteBusy(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "SQLITE_BUSY"
    || (typeof candidate.message === "string" && /database is locked|database is busy/i.test(candidate.message));
}

function assertSafeOperationalPayload(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSafeOperationalPayload(child, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/authorization|cookie|token|secret|password|session|signature|api.?key/i.test(key)) {
        throw new Error(`sensitive outbox field rejected: ${path}.${key}`);
      }
      assertSafeOperationalPayload(child, `${path}.${key}`);
    }
  }
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function fileSha256(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

export class RolloutController {
  constructor(
    readonly db: DatabaseSync,
    readonly repository: ResearchReplayRepository,
    readonly rawStore: RawStore,
    private readonly idFactory: IdFactory = randomUUID,
    private readonly clock: () => string = nowIso,
    private readonly diskFreeBytes: () => number = () => {
      const stats = statfsSync(rawStore.root);
      return Number(stats.bavail) * Number(stats.bsize);
    },
    private readonly monotonicNowMs: () => number = () => performance.now(),
  ) {
    const schema = verifyRolloutSchema(db);
    if (!schema.ok) throw new Error(`rollout schema required: ${JSON.stringify(schema)}`);
  }

  recordApproval(input: {
    approvalEventId?: string;
    approvalScope: string;
    approvalSource: string;
    approvedAt: string;
    detail?: unknown;
  }): string {
    const id = input.approvalEventId ?? this.idFactory();
    this.db.prepare(`
      INSERT INTO rollout_approval_events
      (approval_event_id, approval_scope, approval_source, approved_at, recorded_at, detail_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.approvalScope,
      input.approvalSource,
      canonicalUtcTimestamp(input.approvedAt),
      this.clock(),
      safeJson(input.detail),
    );
    return id;
  }

  recordConfig(
    config: RolloutConfig,
    reason: string,
    occurredAt = this.clock(),
    configEventId?: string,
  ): string {
    if (!Number.isInteger(config.queueCapacity) || config.queueCapacity < 1 || config.queueCapacity > 10_000) {
      throw new Error("invalid queue capacity");
    }
    if (!Number.isInteger(config.maxRetries) || config.maxRetries < 0 || config.maxRetries > 20) {
      throw new Error("invalid max retries");
    }
    if (!Number.isSafeInteger(config.storageQuotaBytes) || config.storageQuotaBytes <= 0) {
      throw new Error("invalid storage quota");
    }
    if (!Number.isSafeInteger(config.diskLowWaterBytes) || config.diskLowWaterBytes < 0) {
      throw new Error("invalid disk low-water mark");
    }
    const id = configEventId ?? this.idFactory();
    this.db.prepare(`
      INSERT INTO rollout_config_events
      (config_event_id, shadow_write_enabled, operational_gc_enabled, kill_switch_engaged,
       queue_capacity, max_retries, storage_quota_bytes, disk_low_water_bytes,
       reason, occurred_at, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      Number(config.shadowWriteEnabled),
      Number(config.operationalGcEnabled),
      Number(config.killSwitchEngaged),
      config.queueCapacity,
      config.maxRetries,
      config.storageQuotaBytes,
      config.diskLowWaterBytes,
      reason,
      canonicalUtcTimestamp(occurredAt),
      this.clock(),
    );
    return id;
  }

  currentConfig(): RolloutConfig {
    const row = this.db.prepare(`
      SELECT shadow_write_enabled, operational_gc_enabled, kill_switch_engaged,
             queue_capacity, max_retries, storage_quota_bytes, disk_low_water_bytes
      FROM rollout_config_events
      ORDER BY occurred_at DESC, rowid DESC LIMIT 1
    `).get() as {
      shadow_write_enabled: number;
      operational_gc_enabled: number;
      kill_switch_engaged: number;
      queue_capacity: number;
      max_retries: number;
      storage_quota_bytes: number;
      disk_low_water_bytes: number;
    } | undefined;
    if (!row) return { ...DEFAULT_ROLLOUT_CONFIG };
    return {
      shadowWriteEnabled: Boolean(row.shadow_write_enabled),
      operationalGcEnabled: Boolean(row.operational_gc_enabled),
      killSwitchEngaged: Boolean(row.kill_switch_engaged),
      queueCapacity: row.queue_capacity,
      maxRetries: row.max_retries,
      storageQuotaBytes: row.storage_quota_bytes,
      diskLowWaterBytes: row.disk_low_water_bytes,
    };
  }

  private currentOutboxRows(): Array<{
    outbox_message_id: string;
    idempotency_key: string;
    message_type: string;
    payload_json: string;
    enqueued_at: string;
    available_at: string;
    attempt_count: number;
    last_outcome: string | null;
    next_available_at: string | null;
  }> {
    return this.db.prepare(`
      SELECT m.outbox_message_id, m.idempotency_key, m.message_type, m.payload_json,
             m.enqueued_at, m.available_at,
             COUNT(a.delivery_attempt_id) AS attempt_count,
             (
               SELECT outcome FROM shadow_delivery_attempts latest
               WHERE latest.outbox_message_id=m.outbox_message_id
               ORDER BY attempt_no DESC LIMIT 1
             ) AS last_outcome,
             (
               SELECT next_available_at FROM shadow_delivery_attempts latest
               WHERE latest.outbox_message_id=m.outbox_message_id
               ORDER BY attempt_no DESC LIMIT 1
             ) AS next_available_at
      FROM shadow_outbox_messages m
      LEFT JOIN shadow_delivery_attempts a ON a.outbox_message_id=m.outbox_message_id
      GROUP BY m.outbox_message_id
      ORDER BY m.enqueued_at, m.outbox_message_id
    `).all() as ReturnType<RolloutController["currentOutboxRows"]>;
  }

  enqueue(input: {
    idempotencyKey: string;
    messageType: string;
    payload: unknown;
    availableAt?: string;
  }): EnqueueResult {
    const config = this.currentConfig();
    if (!config.shadowWriteEnabled) return { status: "disabled", outboxMessageId: null };
    if (config.killSwitchEngaged) return { status: "killed", outboxMessageId: null };
    const existing = this.db.prepare(`
      SELECT outbox_message_id FROM shadow_outbox_messages WHERE idempotency_key=?
    `).get(input.idempotencyKey) as { outbox_message_id: string } | undefined;
    if (existing) return { status: "existing", outboxMessageId: existing.outbox_message_id };
    if (this.totalStorageBytes() >= config.storageQuotaBytes) {
      return { status: "quota_exceeded", outboxMessageId: null };
    }
    if (this.diskFreeBytes() <= config.diskLowWaterBytes) return { status: "disk_low", outboxMessageId: null };
    const queued = this.currentOutboxRows().filter((row) =>
      !["succeeded", "permanent_failure", "cancelled"].includes(row.last_outcome ?? ""),
    ).length;
    if (queued >= config.queueCapacity) return { status: "backpressure", outboxMessageId: null };
    assertSafeOperationalPayload(input.payload);
    const payloadJson = safeJson(input.payload);
    if (Buffer.byteLength(payloadJson, "utf8") > 256 * 1024) throw new Error("outbox payload too large");
    const id = this.idFactory();
    const now = this.clock();
    this.db.prepare(`
      INSERT INTO shadow_outbox_messages
      (outbox_message_id, idempotency_key, message_type, payload_json,
       payload_hash, enqueued_at, available_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.idempotencyKey,
      input.messageType,
      payloadJson,
      canonicalHash(input.payload),
      now,
      canonicalUtcTimestamp(input.availableAt ?? now),
      now,
    );
    return { status: "enqueued", outboxMessageId: id };
  }

  drain(handler: ShadowDeliveryHandler, limit = 100, options: ShadowDrainOptions = {}): ShadowDrainResult {
    const {
      examined: _examined,
      contended: _contended,
      skippedAfterClaim: _skipped,
      handlerDeadlineExceeded: _deadline,
      ...result
    } = this.drainWithDiagnostics(handler, limit, options);
    return result;
  }

  drainWithDiagnostics(
    handler: ShadowDeliveryHandler,
    limit = 100,
    options: ShadowDrainOptions = {},
  ): ShadowDrainDiagnostics {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error("invalid shadow drain limit");
    }
    const handlerWallTimeBudgetMs = options.handlerWallTimeBudgetMs ?? 30_000;
    if (!Number.isSafeInteger(handlerWallTimeBudgetMs)
      || handlerWallTimeBudgetMs < 1
      || handlerWallTimeBudgetMs > 300_000) {
      throw new Error("invalid shadow handler wall-time budget");
    }
    const config = this.currentConfig();
    if (!config.shadowWriteEnabled || config.killSwitchEngaged) {
      return {
        succeeded: 0,
        retrying: 0,
        permanentlyFailed: 0,
        examined: 0,
        contended: 0,
        skippedAfterClaim: 0,
        handlerDeadlineExceeded: 0,
      };
    }
    const now = this.clock();
    const candidates = this.currentOutboxRows().filter((row) => {
      if (["succeeded", "permanent_failure", "cancelled"].includes(row.last_outcome ?? "")) return false;
      return (row.next_available_at ?? row.available_at) <= now;
    }).slice(0, limit);
    let succeeded = 0;
    let retrying = 0;
    let permanentlyFailed = 0;
    let examined = 0;
    let contended = 0;
    let skippedAfterClaim = 0;
    let handlerDeadlineExceeded = 0;
    for (const candidate of candidates) {
      examined += 1;
      try {
        this.db.exec("BEGIN IMMEDIATE");
      } catch (error) {
        if (isSqliteBusy(error)) {
          contended += 1;
          continue;
        }
        throw error;
      }
      try {
        const activeConfig = this.currentConfig();
        const row = this.currentOutboxRows().find(
          (current) => current.outbox_message_id === candidate.outbox_message_id,
        );
        const currentNow = this.clock();
        if (!activeConfig.shadowWriteEnabled
          || activeConfig.killSwitchEngaged
          || !row
          || ["succeeded", "permanent_failure", "cancelled"].includes(row.last_outcome ?? "")
          || (row.next_available_at ?? row.available_at) > currentNow) {
          skippedAfterClaim += 1;
          this.db.exec("COMMIT");
          continue;
        }
        const attemptNo = row.attempt_count + 1;
        const startedAt = currentNow;
        let outcome: "succeeded" | "retryable_failure" | "permanent_failure" = "succeeded";
        let errorCode: string | null = null;
        let nextAvailableAt: string | null = null;
        this.db.exec("SAVEPOINT shadow_delivery_handler");
        try {
          const deadlineAtMonotonicMs = this.monotonicNowMs() + handlerWallTimeBudgetMs;
          const context: ShadowDeliveryContext = {
            deadlineAtMonotonicMs,
            remainingMs: () => Math.max(0, deadlineAtMonotonicMs - this.monotonicNowMs()),
            throwIfCancelled: () => {
              if (this.monotonicNowMs() > deadlineAtMonotonicMs) {
                throw new ShadowDeliveryDeadlineExceededError();
              }
            },
          };
          handler({
            outboxMessageId: row.outbox_message_id,
            messageType: row.message_type,
            payload: JSON.parse(row.payload_json) as unknown,
          }, context);
          context.throwIfCancelled();
          this.db.exec("RELEASE shadow_delivery_handler");
          succeeded += 1;
        } catch (error) {
          this.db.exec("ROLLBACK TO shadow_delivery_handler");
          this.db.exec("RELEASE shadow_delivery_handler");
          errorCode = error instanceof Error ? error.name || "SHADOW_WRITE_FAILED" : "SHADOW_WRITE_FAILED";
          if (error instanceof ShadowDeliveryDeadlineExceededError) handlerDeadlineExceeded += 1;
          const explicitlyPermanent = error instanceof PermanentShadowDeliveryError;
          const retryExhausted = !explicitlyPermanent && attemptNo > activeConfig.maxRetries;
          if (retryExhausted) errorCode = "SHADOW_RETRY_EXHAUSTED";
          if (explicitlyPermanent || retryExhausted) {
            outcome = "permanent_failure";
            permanentlyFailed += 1;
          } else {
            outcome = "retryable_failure";
            const backoffMs = Math.min(60_000, 1000 * 2 ** (attemptNo - 1));
            nextAvailableAt = new Date(new Date(startedAt).getTime() + backoffMs).toISOString();
            retrying += 1;
          }
        }
        this.db.prepare(`
          INSERT INTO shadow_delivery_attempts
          (delivery_attempt_id, outbox_message_id, attempt_no, outcome, error_code,
           started_at, completed_at, next_available_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          this.idFactory(),
          row.outbox_message_id,
          attemptNo,
          outcome,
          errorCode,
          startedAt,
          this.clock(),
          nextAvailableAt,
          this.clock(),
        );
        this.db.exec("COMMIT");
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // Preserve the original failure when the transaction already ended.
        }
        throw error;
      }
    }
    return {
      succeeded,
      retrying,
      permanentlyFailed,
      examined,
      contended,
      skippedAfterClaim,
      handlerDeadlineExceeded,
    };
  }

  runPrimaryWithOptionalShadow<T>(primary: () => T, shadow: () => void): {
    primaryResult: T;
    shadowAttempted: boolean;
    shadowSucceeded: boolean;
    shadowErrorCode: string | null;
  } {
    const primaryResult = primary();
    const config = this.currentConfig();
    if (!config.shadowWriteEnabled || config.killSwitchEngaged) {
      return { primaryResult, shadowAttempted: false, shadowSucceeded: false, shadowErrorCode: null };
    }
    try {
      shadow();
      return { primaryResult, shadowAttempted: true, shadowSucceeded: true, shadowErrorCode: null };
    } catch (error) {
      return {
        primaryResult,
        shadowAttempted: true,
        shadowSucceeded: false,
        shadowErrorCode: error instanceof Error ? error.name || "SHADOW_WRITE_FAILED" : "SHADOW_WRITE_FAILED",
      };
    }
  }

  private auditEvent(input: {
    operationId: string;
    eventKind: string;
    subjectType: string;
    subjectId: string;
    detail?: unknown;
  }): void {
    this.db.prepare(`
      INSERT INTO operational_audit_events
      (audit_event_id, operation_id, event_kind, subject_type, subject_id,
       detail_json, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.idFactory(),
      input.operationId,
      input.eventKind,
      input.subjectType,
      input.subjectId,
      safeJson(input.detail),
      this.clock(),
      this.clock(),
    );
  }

  recordOperationalEvidence(input: {
    operationId: string;
    eventKind:
      | "backup_started"
      | "backup_completed"
      | "restore_verified"
      | "health_snapshot";
    subjectType: string;
    subjectId: string;
    detail?: unknown;
  }): void {
    this.auditEvent(input);
  }

  collectUnreferencedRaw(maxItems = 100): {
    status: "disabled" | "killed" | "not_needed" | "completed";
    deleted: string[];
    rejected: string[];
  } {
    const config = this.currentConfig();
    if (!config.operationalGcEnabled) return { status: "disabled", deleted: [], rejected: [] };
    if (config.killSwitchEngaged) return { status: "killed", deleted: [], rejected: [] };
    if (this.totalStorageBytes() <= config.storageQuotaBytes && this.diskFreeBytes() > config.diskLowWaterBytes) {
      return { status: "not_needed", deleted: [], rejected: [] };
    }
    const rows = this.db.prepare(`
      SELECT r.raw_document_id, r.raw_sha256, r.storage_path
      FROM raw_documents r
      WHERE NOT EXISTS (
        SELECT 1 FROM evidence_pins p
        WHERE p.evidence_type='raw_document' AND p.evidence_id=r.raw_document_id
      )
      AND NOT EXISTS (SELECT 1 FROM capture_raw_links c WHERE c.raw_document_id=r.raw_document_id)
      AND NOT EXISTS (SELECT 1 FROM parse_runs p WHERE p.raw_document_id=r.raw_document_id)
      AND NOT EXISTS (SELECT 1 FROM domain_observations o WHERE o.raw_document_id=r.raw_document_id)
      AND NOT EXISTS (
        SELECT 1 FROM evidence_tombstones t
        WHERE t.evidence_type='raw_document' AND t.evidence_id=r.raw_document_id
      )
      ORDER BY r.first_recorded_at, r.raw_document_id
      LIMIT ?
    `).all(maxItems) as Array<{
      raw_document_id: string;
      raw_sha256: string;
      storage_path: string;
    }>;
    const deleted: string[] = [];
    const rejected: string[] = [];
    for (const row of rows) {
      const stillPinned = this.db.prepare(`
        SELECT 1 FROM evidence_pins
        WHERE evidence_type='raw_document' AND evidence_id=? LIMIT 1
      `).get(row.raw_document_id);
      const operationId = this.idFactory();
      if (stillPinned) {
        rejected.push(row.raw_document_id);
        this.auditEvent({
          operationId,
          eventKind: "gc_rejected",
          subjectType: "raw_document",
          subjectId: row.raw_document_id,
          detail: { reason: "pinned" },
        });
        continue;
      }
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.auditEvent({
          operationId,
          eventKind: "gc_intent",
          subjectType: "raw_document",
          subjectId: row.raw_document_id,
          detail: { rawSha256: row.raw_sha256 },
        });
        this.repository.recordTombstone({
          evidenceType: "raw_document",
          evidenceId: row.raw_document_id,
          reason: "operational_gc_unreferenced",
          recordedAt: this.clock(),
        });
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      this.rawStore.removeVerified(row.storage_path, row.raw_sha256);
      this.auditEvent({
        operationId,
        eventKind: "gc_deleted",
        subjectType: "raw_document",
        subjectId: row.raw_document_id,
        detail: { rawSha256: row.raw_sha256 },
      });
      deleted.push(row.raw_document_id);
    }
    return { status: "completed", deleted, rejected };
  }

  recoverGcIntents(): string[] {
    const rows = this.db.prepare(`
      SELECT intent.operation_id, intent.subject_id, r.raw_sha256, r.storage_path
      FROM operational_audit_events intent
      JOIN raw_documents r ON r.raw_document_id=intent.subject_id
      WHERE intent.event_kind='gc_intent'
        AND NOT EXISTS (
          SELECT 1 FROM operational_audit_events done
          WHERE done.operation_id=intent.operation_id
            AND done.event_kind IN ('gc_deleted', 'gc_recovered')
        )
    `).all() as Array<{
      operation_id: string;
      subject_id: string;
      raw_sha256: string;
      storage_path: string;
    }>;
    const recovered: string[] = [];
    for (const row of rows) {
      const removed = this.rawStore.removeVerified(row.storage_path, row.raw_sha256);
      this.auditEvent({
        operationId: row.operation_id,
        eventKind: "gc_recovered",
        subjectType: "raw_document",
        subjectId: row.subject_id,
        detail: { removed },
      });
      recovered.push(row.subject_id);
    }
    return recovered;
  }

  health(): ShadowHealth {
    const rows = this.currentOutboxRows();
    const raw = this.repository.auditRawCache();
    const sidecarBytes = this.sidecarBytes();
    return {
      config: this.currentConfig(),
      queued: rows.filter((row) => !["succeeded", "permanent_failure", "cancelled"].includes(row.last_outcome ?? "")).length,
      succeeded: rows.filter((row) => row.last_outcome === "succeeded").length,
      retrying: rows.filter((row) => row.last_outcome === "retryable_failure").length,
      permanentlyFailed: rows.filter((row) => row.last_outcome === "permanent_failure").length,
      oldestQueuedAt: rows.find((row) =>
        !["succeeded", "permanent_failure", "cancelled"].includes(row.last_outcome ?? ""),
      )?.enqueued_at ?? null,
      rawStorageBytes: raw.storageBytes,
      sidecarBytes,
      totalStorageBytes: raw.storageBytes + sidecarBytes,
      diskFreeBytes: this.diskFreeBytes(),
      schemaOk: verifyRolloutSchema(this.db).ok,
    };
  }

  private sidecarBytes(): number {
    const pageCount = Number((this.db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count);
    const pageSize = Number((this.db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size);
    return pageCount * pageSize;
  }

  private totalStorageBytes(): number {
    return this.repository.auditRawCache().storageBytes + this.sidecarBytes();
  }

  recordHealthSnapshot(): ShadowHealth {
    const health = this.health();
    this.auditEvent({
      operationId: this.idFactory(),
      eventKind: "health_snapshot",
      subjectType: "research_sidecar",
      subjectId: "current",
      detail: health,
    });
    return health;
  }

  recordDrainDiagnostics(
    diagnostics: ShadowDrainDiagnostics,
    operationId = this.idFactory(),
  ): ShadowHealth {
    assertShadowDrainDiagnostics(diagnostics);
    const health = this.health();
    this.auditEvent({
      operationId,
      eventKind: "health_snapshot",
      subjectType: "shadow_outbox_drain",
      subjectId: "current",
      detail: { health, drainDiagnostics: diagnostics },
    });
    return health;
  }

  rollback(reason: string): RolloutConfig {
    const operationId = this.idFactory();
    this.auditEvent({
      operationId,
      eventKind: "rollback_started",
      subjectType: "research_writer",
      subjectId: "shadow",
      detail: { reason },
    });
    const current = this.currentConfig();
    const stopped = {
      ...current,
      shadowWriteEnabled: false,
      operationalGcEnabled: false,
      killSwitchEngaged: true,
    };
    this.recordConfig(stopped, `rollback: ${reason}`);
    this.auditEvent({
      operationId,
      eventKind: "rollback_completed",
      subjectType: "research_writer",
      subjectId: "shadow",
      detail: { shadowWriteEnabled: false, killSwitchEngaged: true },
    });
    return stopped;
  }
}

export type BackupEvidence = {
  path: string;
  sha256: string;
  bytes: number;
  quickCheck: string;
  schemaOk: boolean;
};

export function backupSidecar(db: DatabaseSync, destination: string): BackupEvidence {
  if (existsSync(destination)) throw new Error("backup destination already exists");
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  db.exec(`VACUUM INTO ${quoteSqlString(destination)}`);
  chmodSync(destination, 0o600);
  const fd = openSync(destination, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const backup = new DatabaseSync(destination, { readOnly: true });
  try {
    const quickCheck = (backup.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check;
    return {
      path: destination,
      sha256: fileSha256(destination),
      bytes: statSync(destination).size,
      quickCheck,
      schemaOk: verifyRolloutSchema(backup).ok,
    };
  } finally {
    backup.close();
  }
}

export function restoreSidecar(backupPath: string, destination: string): BackupEvidence {
  if (existsSync(destination)) throw new Error("restore destination already exists");
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(backupPath, destination);
  chmodSync(destination, 0o600);
  const fd = openSync(destination, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const restored = new DatabaseSync(destination, { readOnly: true });
  try {
    const quickCheck = (restored.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check;
    return {
      path: destination,
      sha256: fileSha256(destination),
      bytes: statSync(destination).size,
      quickCheck,
      schemaOk: verifyRolloutSchema(restored).ok,
    };
  } finally {
    restored.close();
  }
}
