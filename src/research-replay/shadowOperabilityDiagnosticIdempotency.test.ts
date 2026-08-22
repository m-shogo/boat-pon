import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildShadowOperabilityReport, type ShadowOperabilityThresholds } from "./shadowOperability";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

const permissiveThresholds: ShadowOperabilityThresholds = {
  maxQueued: 100,
  maxReadyQueued: 100,
  maxOldestQueuedAgeMs: 60_000,
  maxRetrying: 100,
  maxPermanentlyFailed: 100,
  maxRetryExhausted: 100,
  maxContentionRate: 1,
  maxHandlerDeadlineExceeded: 100,
};

const drainDiagnostics = JSON.stringify({
  drainDiagnostics: {
    contended: 0,
    examined: 1,
    handlerDeadlineExceeded: 0,
    permanentlyFailed: 0,
    retrying: 0,
    skippedAfterClaim: 0,
    succeeded: 1,
  },
});

function insertDiagnostic(
  db: ReturnType<typeof openRolloutDatabase>,
  auditId: string,
  operationId: string,
  occurredAt: string,
): void {
  db.prepare(`
    INSERT INTO operational_audit_events
    (audit_event_id, operation_id, event_kind, subject_type, subject_id,
     detail_json, occurred_at, created_at)
    VALUES (?, ?, 'health_snapshot', 'shadow_outbox_drain', 'current', ?, ?, ?)
  `).run(auditId, operationId, drainDiagnostics, occurredAt, occurredAt);
}

test("duplicate shadow drain operation evidence fails closed instead of double counting metrics", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-operability-diagnostic-idempotency-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    initializeRolloutSchema(db, "2026-08-02T04:00:00.000Z");
    insertDiagnostic(db, "drain-audit-1", "duplicate-drain-operation", "2026-08-02T04:00:00.000Z");
    insertDiagnostic(db, "drain-audit-2", "duplicate-drain-operation", "2026-08-02T04:00:01.000Z");

    assert.throws(() => buildShadowOperabilityReport(db, {
      policyVersion: "fixture-safe-v1",
      asOf: "2026-08-02T04:00:31.000Z",
      diagnosticsWindowMs: 60_000,
      thresholds: permissiveThresholds,
    }), /duplicate shadow drain diagnostic operation/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("duplicate shadow drain operation fails closed even when the older row is outside the report window", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-operability-diagnostic-window-idempotency-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    initializeRolloutSchema(db, "2026-08-02T03:00:00.000Z");
    insertDiagnostic(db, "drain-audit-old", "reused-drain-operation", "2026-08-02T03:00:00.000Z");
    insertDiagnostic(db, "drain-audit-current", "reused-drain-operation", "2026-08-02T04:00:00.000Z");

    assert.throws(() => buildShadowOperabilityReport(db, {
      policyVersion: "fixture-safe-v1",
      asOf: "2026-08-02T04:00:31.000Z",
      diagnosticsWindowMs: 60_000,
      thresholds: permissiveThresholds,
    }), /duplicate shadow drain diagnostic operation/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
