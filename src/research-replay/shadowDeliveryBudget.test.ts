import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { DEFAULT_ROLLOUT_CONFIG, RolloutController } from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

function testContext() {
  const dir = mkdtempSync(join(tmpdir(), "shadow-delivery-budget-"));
  const db = openRolloutDatabase(join(dir, "sidecar.sqlite"));
  initializeRolloutSchema(db, "2026-08-02T03:00:00Z");
  const rawStore = new RawStore(join(dir, "raw"));
  let sequence = 0;
  let monotonicMs = 0;
  const clock = () => "2026-08-02T03:05:00.000Z";
  const repository = new ResearchReplayRepository(db, rawStore, () => `budget-${++sequence}`, clock);
  const controller = new RolloutController(
    db,
    repository,
    rawStore,
    () => `budget-${++sequence}`,
    clock,
    () => Number.MAX_SAFE_INTEGER,
    () => monotonicMs,
  );
  controller.recordConfig({
    ...DEFAULT_ROLLOUT_CONFIG,
    shadowWriteEnabled: true,
    storageQuotaBytes: 1024 * 1024 * 1024,
    diskLowWaterBytes: 0,
  }, "temp delivery budget test");
  return {
    db,
    controller,
    setMonotonicMs(value: number) { monotonicMs = value; },
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function insertHandlerSideEffect(ctx: ReturnType<typeof testContext>, operationId: string): void {
  ctx.db.prepare(`
    INSERT INTO operational_audit_events
    (audit_event_id, operation_id, event_kind, subject_type, subject_id,
     detail_json, occurred_at, created_at)
    VALUES (?, ?, 'health_snapshot', 'fixture', 'handler', '{}', ?, ?)
  `).run(
    `audit-${operationId}`,
    operationId,
    "2026-08-02T03:05:00.000Z",
    "2026-08-02T03:05:00.000Z",
  );
}

test("retryable handler failure rolls back partial handler writes before recording the attempt", () => {
  const ctx = testContext();
  try {
    ctx.controller.enqueue({
      idempotencyKey: "budget-message-failure",
      messageType: "fixture.budget.v1",
      payload: { value: 1 },
    });
    const diagnostics = ctx.controller.drainWithDiagnostics(() => {
      insertHandlerSideEffect(ctx, "partial-write");
      throw new Error("temporary failure after write");
    });
    assert.deepEqual(diagnostics, {
      succeeded: 0,
      retrying: 1,
      permanentlyFailed: 0,
      examined: 1,
      contended: 0,
      skippedAfterClaim: 0,
      handlerDeadlineExceeded: 0,
    });
    assert.equal((ctx.db.prepare(`
      SELECT COUNT(*) n FROM operational_audit_events WHERE operation_id='partial-write'
    `).get() as { n: number }).n, 0);
    assert.equal((ctx.db.prepare(`
      SELECT COUNT(*) n FROM shadow_delivery_attempts WHERE outcome='retryable_failure'
    `).get() as { n: number }).n, 1);
  } finally { ctx.close(); }
});

test("deadline overrun rolls back handler writes and is aggregated without message payload", () => {
  const ctx = testContext();
  try {
    ctx.controller.enqueue({
      idempotencyKey: "budget-message-deadline",
      messageType: "fixture.budget.v1",
      payload: { payloadText: "message payload must not enter diagnostics" },
    });
    const diagnostics = ctx.controller.drainWithDiagnostics((_message, cancellation) => {
      assert.equal(cancellation.deadlineAtMonotonicMs, 10);
      assert.equal(cancellation.remainingMs(), 10);
      insertHandlerSideEffect(ctx, "deadline-write");
      ctx.setMonotonicMs(11);
      cancellation.throwIfCancelled();
    }, 1, { handlerWallTimeBudgetMs: 10 });
    assert.deepEqual(diagnostics, {
      succeeded: 0,
      retrying: 1,
      permanentlyFailed: 0,
      examined: 1,
      contended: 0,
      skippedAfterClaim: 0,
      handlerDeadlineExceeded: 1,
    });
    assert.equal((ctx.db.prepare(`
      SELECT COUNT(*) n FROM operational_audit_events WHERE operation_id='deadline-write'
    `).get() as { n: number }).n, 0);
    const attempt = ctx.db.prepare(`
      SELECT outcome, error_code FROM shadow_delivery_attempts
    `).get() as { outcome: string; error_code: string };
    assert.deepEqual({ ...attempt }, {
      outcome: "retryable_failure",
      error_code: "SHADOW_HANDLER_DEADLINE_EXCEEDED",
    });

    const health = ctx.controller.recordDrainDiagnostics(diagnostics, "drain-health-operation");
    assert.equal(health.queued, 1);
    const audit = ctx.db.prepare(`
      SELECT detail_json FROM operational_audit_events
      WHERE operation_id='drain-health-operation'
    `).get() as { detail_json: string };
    const detail = JSON.parse(audit.detail_json) as {
      health: { queued: number };
      drainDiagnostics: typeof diagnostics;
    };
    assert.equal(detail.health.queued, 1);
    assert.deepEqual(detail.drainDiagnostics, diagnostics);
    assert.equal(audit.detail_json.includes("message payload must not enter diagnostics"), false);
  } finally { ctx.close(); }
});

test("inconsistent diagnostics are refused instead of entering health evidence", () => {
  const ctx = testContext();
  try {
    assert.throws(() => ctx.controller.recordDrainDiagnostics({
      succeeded: 1,
      retrying: 0,
      permanentlyFailed: 0,
      examined: 0,
      contended: 0,
      skippedAfterClaim: 0,
      handlerDeadlineExceeded: 0,
    }), /inconsistent shadow drain diagnostics/);
  } finally { ctx.close(); }
});
