import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildShadowOperabilityReport, type ShadowOperabilityThresholds } from "./shadowOperability";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

const thresholds: ShadowOperabilityThresholds = {
  maxQueued: 100,
  maxReadyQueued: 100,
  maxOldestQueuedAgeMs: 60_000,
  maxRetrying: 100,
  maxPermanentlyFailed: 100,
  maxRetryExhausted: 100,
  maxContentionRate: 1,
  maxHandlerDeadlineExceeded: 100,
};

test("shadow operability rejects drain diagnostics attached to a noncanonical subject", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-operability-diagnostic-subject-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    initializeRolloutSchema(db, "2026-08-02T04:00:00.000Z");
    db.prepare(`
      INSERT INTO operational_audit_events
      (audit_event_id, operation_id, event_kind, subject_type, subject_id,
       detail_json, occurred_at, created_at)
      VALUES ('subject-audit', 'subject-operation', 'health_snapshot',
              'shadow_outbox_drain', 'other', ?, ?, ?)
    `).run(
      JSON.stringify({
        drainDiagnostics: {
          succeeded: 0,
          retrying: 0,
          permanentlyFailed: 0,
          examined: 1,
          contended: 1,
          skippedAfterClaim: 0,
          handlerDeadlineExceeded: 0,
        },
      }),
      "2026-08-02T04:00:00.000Z",
      "2026-08-02T04:00:00.000Z",
    );

    assert.throws(() => buildShadowOperabilityReport(db, {
      policyVersion: "fixture-safe-v1",
      asOf: "2026-08-02T04:00:31.000Z",
      diagnosticsWindowMs: 60_000,
      thresholds,
    }), /invalid shadow drain diagnostic subject/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
