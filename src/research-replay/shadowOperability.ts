import { DatabaseSync } from "node:sqlite";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { assertShadowDrainDiagnostics, type ShadowDrainDiagnostics } from "./rollout";
import { verifyRolloutSchema } from "./schema";

export type ShadowOperabilityThresholds = {
  maxQueued: number;
  maxReadyQueued: number;
  maxOldestQueuedAgeMs: number;
  maxRetrying: number;
  maxPermanentlyFailed: number;
  maxRetryExhausted: number;
  maxContentionRate: number;
  maxHandlerDeadlineExceeded: number;
};

export type ShadowOperabilityReport = {
  reportVersion: "shadow-operability-v1";
  policyVersion: string;
  asOf: string;
  diagnosticsWindowMs: number;
  thresholds: ShadowOperabilityThresholds;
  metrics: {
    queued: number;
    readyQueued: number;
    retrying: number;
    permanentlyFailed: number;
    retryExhausted: number;
    oldestQueuedAgeMs: number | null;
    diagnosticRuns: number;
    examined: number;
    contended: number;
    contentionRate: number;
    handlerDeadlineExceeded: number;
  };
  status: "PASS" | "WARN" | "BLOCKED";
  reasons: string[];
  digest: string;
};

type CurrentOutboxRow = {
  enqueued_at: string;
  available_at: string;
  last_outcome: string | null;
  last_error_code: string | null;
  next_available_at: string | null;
};

const TERMINAL_OUTCOMES = new Set(["succeeded", "permanent_failure", "cancelled"]);

function timestampMs(value: string, name: string): number {
  const canonical = canonicalUtcTimestamp(value);
  if (canonical !== value) throw new Error(`non-canonical ${name}`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`invalid ${name}`);
  return milliseconds;
}

function assertThresholds(thresholds: ShadowOperabilityThresholds): void {
  for (const [name, value] of Object.entries(thresholds)) {
    if (name === "maxContentionRate") {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`invalid ${name}`);
    } else if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`invalid ${name}`);
    }
  }
}

function parseDiagnostics(detailJson: string): ShadowDrainDiagnostics {
  let detail: unknown;
  try {
    detail = JSON.parse(detailJson) as unknown;
  } catch {
    throw new Error("invalid shadow drain health JSON");
  }
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    throw new Error("invalid shadow drain health detail");
  }
  const diagnostics = (detail as { drainDiagnostics?: unknown }).drainDiagnostics;
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) {
    throw new Error("missing shadow drain diagnostics");
  }
  const expectedKeys = [
    "contended",
    "examined",
    "handlerDeadlineExceeded",
    "permanentlyFailed",
    "retrying",
    "skippedAfterClaim",
    "succeeded",
  ];
  if (Object.keys(diagnostics).sort().join("\0") !== expectedKeys.join("\0")) {
    throw new Error("invalid shadow drain diagnostics shape");
  }
  const typed = diagnostics as ShadowDrainDiagnostics;
  assertShadowDrainDiagnostics(typed);
  return typed;
}

export function buildShadowOperabilityReport(
  db: DatabaseSync,
  input: {
    policyVersion: string;
    asOf: string;
    diagnosticsWindowMs: number;
    thresholds: ShadowOperabilityThresholds;
  },
): ShadowOperabilityReport {
  const schema = verifyRolloutSchema(db);
  if (!schema.ok) throw new Error(`rollout schema required: ${JSON.stringify(schema)}`);
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(input.policyVersion)) throw new Error("invalid policy version");
  if (!Number.isSafeInteger(input.diagnosticsWindowMs) || input.diagnosticsWindowMs < 1) {
    throw new Error("invalid diagnostics window");
  }
  assertThresholds(input.thresholds);
  const asOf = canonicalUtcTimestamp(input.asOf);
  if (asOf !== input.asOf) throw new Error("non-canonical report asOf");
  const asOfMs = timestampMs(asOf, "report asOf");
  const windowStartMs = asOfMs - input.diagnosticsWindowMs;

  const rows = db.prepare(`
    SELECT m.enqueued_at, m.available_at,
      (SELECT outcome FROM shadow_delivery_attempts a
       WHERE a.outbox_message_id=m.outbox_message_id ORDER BY attempt_no DESC LIMIT 1) last_outcome,
      (SELECT error_code FROM shadow_delivery_attempts a
       WHERE a.outbox_message_id=m.outbox_message_id ORDER BY attempt_no DESC LIMIT 1) last_error_code,
      (SELECT next_available_at FROM shadow_delivery_attempts a
       WHERE a.outbox_message_id=m.outbox_message_id ORDER BY attempt_no DESC LIMIT 1) next_available_at
    FROM shadow_outbox_messages m
  `).all() as CurrentOutboxRow[];

  let queued = 0;
  let readyQueued = 0;
  let retrying = 0;
  let permanentlyFailed = 0;
  let retryExhausted = 0;
  let oldestQueuedAgeMs: number | null = null;
  for (const row of rows) {
    const enqueuedMs = timestampMs(row.enqueued_at, "outbox enqueued_at");
    timestampMs(row.available_at, "outbox available_at");
    if (row.next_available_at !== null) timestampMs(row.next_available_at, "attempt next_available_at");
    if (row.last_outcome === "permanent_failure") {
      permanentlyFailed += 1;
      if (row.last_error_code === "SHADOW_RETRY_EXHAUSTED") retryExhausted += 1;
    }
    if (row.last_outcome === "retryable_failure") retrying += 1;
    if (TERMINAL_OUTCOMES.has(row.last_outcome ?? "")) continue;
    if (enqueuedMs > asOfMs) throw new Error("future outbox enqueue timestamp");
    queued += 1;
    const age = asOfMs - enqueuedMs;
    oldestQueuedAgeMs = Math.max(oldestQueuedAgeMs ?? 0, age);
    const effectiveAvailableAt = row.next_available_at ?? row.available_at;
    if (timestampMs(effectiveAvailableAt, "effective available_at") <= asOfMs) readyQueued += 1;
  }

  const auditCandidates = db.prepare(`
    SELECT occurred_at, detail_json FROM operational_audit_events
    WHERE event_kind='health_snapshot' AND subject_type='shadow_outbox_drain'
    ORDER BY audit_event_id
  `).all() as Array<{ occurred_at: string; detail_json: string }>;
  const auditRows = auditCandidates.filter((row) => {
    const occurredAtMs = timestampMs(row.occurred_at, "diagnostic occurred_at");
    return occurredAtMs >= windowStartMs && occurredAtMs <= asOfMs;
  });
  let examined = 0;
  let contended = 0;
  let handlerDeadlineExceeded = 0;
  for (const row of auditRows) {
    const diagnostics = parseDiagnostics(row.detail_json);
    examined += diagnostics.examined;
    contended += diagnostics.contended;
    handlerDeadlineExceeded += diagnostics.handlerDeadlineExceeded;
  }
  const contentionRate = examined === 0 ? 0 : contended / examined;
  const metrics = {
    queued,
    readyQueued,
    retrying,
    permanentlyFailed,
    retryExhausted,
    oldestQueuedAgeMs,
    diagnosticRuns: auditRows.length,
    examined,
    contended,
    contentionRate,
    handlerDeadlineExceeded,
  };
  const blocked: string[] = [];
  const warned: string[] = [];
  if (queued > input.thresholds.maxQueued) blocked.push("queued_exceeded");
  if ((oldestQueuedAgeMs ?? 0) > input.thresholds.maxOldestQueuedAgeMs) blocked.push("oldest_queue_age_exceeded");
  if (retrying > input.thresholds.maxRetrying) blocked.push("retrying_exceeded");
  if (permanentlyFailed > input.thresholds.maxPermanentlyFailed) blocked.push("permanent_failure_exceeded");
  if (retryExhausted > input.thresholds.maxRetryExhausted) blocked.push("retry_exhausted_exceeded");
  if (handlerDeadlineExceeded > input.thresholds.maxHandlerDeadlineExceeded) {
    blocked.push("handler_deadline_exceeded");
  }
  if (readyQueued > input.thresholds.maxReadyQueued) warned.push("ready_queue_exceeded");
  if (contentionRate > input.thresholds.maxContentionRate) warned.push("contention_rate_exceeded");
  const reasons = [...blocked, ...warned].sort();
  const status: ShadowOperabilityReport["status"] = blocked.length > 0
    ? "BLOCKED"
    : warned.length > 0 ? "WARN" : "PASS";
  const unsigned = {
    reportVersion: "shadow-operability-v1" as const,
    policyVersion: input.policyVersion,
    asOf,
    diagnosticsWindowMs: input.diagnosticsWindowMs,
    thresholds: input.thresholds,
    metrics,
    status,
    reasons,
  };
  return { ...unsigned, digest: canonicalHash(unsigned) };
}
