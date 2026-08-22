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

test("operability refuses a forged high attempt number that could hide a queued message", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-operability-attempt-lineage-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    initializeRolloutSchema(db, "2026-08-02T04:00:00.000Z");
    db.prepare(`
      INSERT INTO shadow_outbox_messages
      (outbox_message_id, idempotency_key, message_type, payload_json, payload_hash,
       enqueued_at, available_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "message-1",
      "message-1-key",
      "fixture.v1",
      "{}",
      "a".repeat(64),
      "2026-08-02T04:00:00.000Z",
      "2026-08-02T04:00:00.000Z",
      "2026-08-02T04:00:00.000Z",
    );
    db.prepare(`
      INSERT INTO shadow_delivery_attempts
      (delivery_attempt_id, outbox_message_id, attempt_no, outcome, error_code,
       started_at, completed_at, next_available_at, created_at)
      VALUES (?, ?, 2, 'succeeded', NULL, ?, ?, NULL, ?)
    `).run(
      "attempt-2",
      "message-1",
      "2026-08-02T04:00:01.000Z",
      "2026-08-02T04:00:01.000Z",
      "2026-08-02T04:00:01.000Z",
    );

    assert.throws(() => buildShadowOperabilityReport(db, {
      policyVersion: "fixture-safe-v1",
      asOf: "2026-08-02T04:00:31.000Z",
      diagnosticsWindowMs: 60_000,
      thresholds: permissiveThresholds,
    }), /non-contiguous shadow delivery attempt sequence/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
