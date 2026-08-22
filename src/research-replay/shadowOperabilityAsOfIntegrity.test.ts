import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalHash } from "./canonical";
import { assertShadowDeliveryAttemptHistory } from "./shadowDeliveryAttemptEvidence";
import { buildShadowOperabilityReport, type ShadowOperabilityThresholds } from "./shadowOperability";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

const thresholds: ShadowOperabilityThresholds = {
  maxQueued: 10,
  maxReadyQueued: 10,
  maxOldestQueuedAgeMs: 60_000,
  maxRetrying: 10,
  maxPermanentlyFailed: 10,
  maxRetryExhausted: 10,
  maxContentionRate: 1,
  maxHandlerDeadlineExceeded: 10,
};

function withDb(run: (db: ReturnType<typeof openRolloutDatabase>) => void): void {
  const root = mkdtempSync(join(tmpdir(), "shadow-operability-asof-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    initializeRolloutSchema(db, "2026-08-02T04:00:00.000Z");
    run(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function insertMessage(db: ReturnType<typeof openRolloutDatabase>, enqueuedAt: string): void {
  db.prepare(`
    INSERT INTO shadow_outbox_messages
    (outbox_message_id, idempotency_key, message_type, payload_json, payload_hash,
     enqueued_at, available_at, created_at)
    VALUES ('message-1', 'message-key-1', 'fixture.v1', '{}', ?, ?, ?, ?)
  `).run(canonicalHash({}), enqueuedAt, enqueuedAt, enqueuedAt);
}

function insertSucceededAttempt(
  db: ReturnType<typeof openRolloutDatabase>,
  startedAt: string,
  completedAt: string,
): void {
  db.prepare(`
    INSERT INTO shadow_delivery_attempts
    (delivery_attempt_id, outbox_message_id, attempt_no, outcome, error_code,
     started_at, completed_at, next_available_at, created_at)
    VALUES ('attempt-1', 'message-1', 1, 'succeeded', NULL, ?, ?, NULL, ?)
  `).run(startedAt, completedAt, completedAt);
}

test("shadow attempt evidence rejects delivery before the message was enqueued", () => {
  withDb((db) => {
    insertMessage(db, "2026-08-02T04:10:00.000Z");
    insertSucceededAttempt(db, "2026-08-02T04:01:00.000Z", "2026-08-02T04:01:01.000Z");
    assert.throws(
      () => assertShadowDeliveryAttemptHistory(db),
      /shadow delivery attempt started before message enqueue/,
    );
  });
});

test("shadow operability refuses delivery evidence that occurs after report asOf", () => {
  withDb((db) => {
    insertMessage(db, "2026-08-02T04:00:00.000Z");
    insertSucceededAttempt(db, "2026-08-02T04:10:00.000Z", "2026-08-02T04:10:01.000Z");
    assert.throws(() => buildShadowOperabilityReport(db, {
      policyVersion: "fixture-asof-v1",
      asOf: "2026-08-02T04:05:00.000Z",
      diagnosticsWindowMs: 60_000,
      thresholds,
    }), /future shadow delivery attempt timestamp/);
  });
});

test("shadow operability refuses terminal messages enqueued after report asOf", () => {
  withDb((db) => {
    insertMessage(db, "2026-08-02T04:10:00.000Z");
    assert.throws(() => buildShadowOperabilityReport(db, {
      policyVersion: "fixture-asof-v1",
      asOf: "2026-08-02T04:05:00.000Z",
      diagnosticsWindowMs: 60_000,
      thresholds,
    }), /future outbox enqueue timestamp/);
  });
});
