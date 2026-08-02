import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { DEFAULT_ROLLOUT_CONFIG, RolloutController } from "./rollout";
import { buildShadowOperabilityReport, type ShadowOperabilityThresholds } from "./shadowOperability";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

function context() {
  const root = mkdtempSync(join(tmpdir(), "shadow-operability-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  initializeRolloutSchema(db, "2026-08-02T04:00:00.000Z");
  const rawStore = new RawStore(join(root, "raw"));
  let sequence = 0;
  let now = "2026-08-02T04:00:00.000Z";
  const repository = new ResearchReplayRepository(db, rawStore, () => `operability-${++sequence}`, () => now);
  const controller = new RolloutController(
    db,
    repository,
    rawStore,
    () => `operability-${++sequence}`,
    () => now,
    () => Number.MAX_SAFE_INTEGER,
  );
  controller.recordConfig({
    ...DEFAULT_ROLLOUT_CONFIG,
    shadowWriteEnabled: true,
    maxRetries: 1,
    diskLowWaterBytes: 0,
  }, "fixture-only operability policy");
  return {
    db,
    controller,
    setNow(value: string) { now = value; },
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const strictThresholds: ShadowOperabilityThresholds = {
  maxQueued: 0,
  maxReadyQueued: 0,
  maxOldestQueuedAgeMs: 30_000,
  maxRetrying: 0,
  maxPermanentlyFailed: 0,
  maxRetryExhausted: 0,
  maxContentionRate: 0.1,
  maxHandlerDeadlineExceeded: 0,
};

test("retry exhaustion has an immutable error marker distinct from explicit permanent failure", () => {
  const ctx = context();
  try {
    ctx.controller.enqueue({ idempotencyKey: "exhausted", messageType: "fixture.v1", payload: { id: 1 } });
    assert.equal(ctx.controller.drain(() => { throw new Error("network down"); }).retrying, 1);
    ctx.setNow("2026-08-02T04:00:01.000Z");
    assert.equal(ctx.controller.drain(() => { throw new Error("network still down"); }).permanentlyFailed, 1);
    const attempt = ctx.db.prepare(`
      SELECT outcome, error_code FROM shadow_delivery_attempts
      WHERE attempt_no=2
    `).get() as { outcome: string; error_code: string };
    assert.deepEqual({ ...attempt }, {
      outcome: "permanent_failure",
      error_code: "SHADOW_RETRY_EXHAUSTED",
    });
  } finally { ctx.close(); }
});

test("read-only operability report aggregates backlog, exhaustion and drain diagnostics", () => {
  const ctx = context();
  try {
    ctx.controller.enqueue({ idempotencyKey: "exhausted", messageType: "fixture.v1", payload: { id: 1 } });
    ctx.controller.drain(() => { throw new Error("temporary"); });
    ctx.setNow("2026-08-02T04:00:01.000Z");
    ctx.controller.drain(() => { throw new Error("temporary"); });

    ctx.controller.enqueue({ idempotencyKey: "retrying", messageType: "fixture.v1", payload: { id: 2 } });
    const diagnostics = ctx.controller.drainWithDiagnostics(() => { throw new Error("temporary"); }, 1);
    ctx.controller.recordDrainDiagnostics({
      ...diagnostics,
      contended: 1,
      examined: diagnostics.examined + 1,
      handlerDeadlineExceeded: 1,
    }, "fixture-drain-health");
    ctx.setNow("2026-08-02T04:00:31.000Z");
    const before = (ctx.db.prepare("SELECT total_changes() n").get() as { n: number }).n;
    const report = buildShadowOperabilityReport(ctx.db, {
      policyVersion: "fixture-strict-v1",
      asOf: "2026-08-02T04:00:31.000Z",
      diagnosticsWindowMs: 60_000,
      thresholds: strictThresholds,
    });
    const after = (ctx.db.prepare("SELECT total_changes() n").get() as { n: number }).n;
    assert.equal(after, before);
    assert.deepEqual(report.metrics, {
      queued: 1,
      readyQueued: 1,
      retrying: 1,
      permanentlyFailed: 1,
      retryExhausted: 1,
      oldestQueuedAgeMs: 30_000,
      diagnosticRuns: 1,
      examined: 2,
      contended: 1,
      contentionRate: 0.5,
      handlerDeadlineExceeded: 1,
    });
    assert.equal(report.status, "BLOCKED");
    assert.deepEqual(report.reasons, [
      "contention_rate_exceeded",
      "handler_deadline_exceeded",
      "permanent_failure_exceeded",
      "queued_exceeded",
      "ready_queue_exceeded",
      "retry_exhausted_exceeded",
      "retrying_exceeded",
    ]);
    assert.match(report.digest, /^[a-f0-9]{64}$/);
    assert.equal(buildShadowOperabilityReport(ctx.db, {
      policyVersion: "fixture-strict-v1",
      asOf: "2026-08-02T04:00:31.000Z",
      diagnosticsWindowMs: 60_000,
      thresholds: strictThresholds,
    }).digest, report.digest);
  } finally { ctx.close(); }
});

test("malformed historical diagnostics fail closed", () => {
  const ctx = context();
  try {
    ctx.db.prepare(`
      INSERT INTO operational_audit_events
      (audit_event_id, operation_id, event_kind, subject_type, subject_id,
       detail_json, occurred_at, created_at)
      VALUES ('malformed-audit', 'malformed-operation', 'health_snapshot',
              'shadow_outbox_drain', 'current', '{"drainDiagnostics":{"examined":1}}', ?, ?)
    `).run("2026-08-02T04:00:00.000Z", "2026-08-02T04:00:00.000Z");
    assert.throws(() => buildShadowOperabilityReport(ctx.db, {
      policyVersion: "fixture-strict-v1",
      asOf: "2026-08-02T04:00:01.000Z",
      diagnosticsWindowMs: 60_000,
      thresholds: strictThresholds,
    }), /invalid shadow drain diagnostics shape/);
  } finally { ctx.close(); }
});
