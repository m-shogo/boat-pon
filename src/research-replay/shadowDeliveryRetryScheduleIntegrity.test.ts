import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { assertShadowDeliveryAttemptHistory } from "./shadowDeliveryAttemptEvidence";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

test("retryable shadow delivery attempt must keep the producer backoff schedule", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-retry-schedule-integrity-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    const enqueuedAt = "2026-08-23T00:00:00.000Z";
    const startedAt = "2026-08-23T00:00:10.000Z";
    initializeRolloutSchema(db, enqueuedAt);
    const payload = { id: 1 };
    db.prepare(`
      INSERT INTO shadow_outbox_messages
      (outbox_message_id, idempotency_key, message_type, payload_json,
       payload_hash, enqueued_at, available_at, created_at)
      VALUES ('message-1', 'message-1-key', 'fixture.v1', ?, ?, ?, ?, ?)
    `).run(
      JSON.stringify(payload),
      canonicalHash(payload),
      enqueuedAt,
      enqueuedAt,
      enqueuedAt,
    );
    db.prepare(`
      INSERT INTO shadow_delivery_attempts
      (delivery_attempt_id, outbox_message_id, attempt_no, outcome, error_code,
       started_at, completed_at, next_available_at, created_at)
      VALUES ('attempt-1', 'message-1', 1, 'retryable_failure', 'FIXTURE_RETRY', ?, ?, ?, ?)
    `).run(
      startedAt,
      "2026-08-23T00:00:10.100Z",
      "2026-08-23T00:00:20.000Z",
      "2026-08-23T00:00:10.100Z",
    );

    assert.throws(
      () => assertShadowDeliveryAttemptHistory(db, "2026-08-23T00:01:00.000Z"),
      /shadow delivery retry schedule drift/,
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
