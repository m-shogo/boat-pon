import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertShadowDeliveryAttemptHistory } from "./shadowDeliveryAttemptEvidence";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

function insertOutboxMessage(db: ReturnType<typeof openRolloutDatabase>): void {
  db.prepare(`
    INSERT INTO shadow_outbox_messages
    (outbox_message_id, idempotency_key, message_type, payload_json, payload_hash,
     enqueued_at, available_at, created_at)
    VALUES ('message-1', 'message-1-key', 'fixture.v1', '{}', ?, ?, ?, ?)
  `).run(
    "a".repeat(64),
    "2026-08-02T04:00:00.000Z",
    "2026-08-02T04:00:00.000Z",
    "2026-08-02T04:00:00.000Z",
  );
}

test("shadow attempt history rejects an attempt appended after a terminal outcome", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-attempt-terminal-lineage-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    initializeRolloutSchema(db, "2026-08-02T04:00:00.000Z");
    insertOutboxMessage(db);
    const insertAttempt = db.prepare(`
      INSERT INTO shadow_delivery_attempts
      (delivery_attempt_id, outbox_message_id, attempt_no, outcome, error_code,
       started_at, completed_at, next_available_at, created_at)
      VALUES (?, 'message-1', ?, ?, ?, ?, ?, NULL, ?)
    `);
    insertAttempt.run(
      "attempt-1",
      1,
      "permanent_failure",
      "FIXTURE_PERMANENT_FAILURE",
      "2026-08-02T04:00:01.000Z",
      "2026-08-02T04:00:02.000Z",
      "2026-08-02T04:00:02.000Z",
    );
    insertAttempt.run(
      "attempt-2",
      2,
      "succeeded",
      null,
      "2026-08-02T04:00:03.000Z",
      "2026-08-02T04:00:04.000Z",
      "2026-08-02T04:00:04.000Z",
    );

    assert.throws(
      () => assertShadowDeliveryAttemptHistory(db),
      /shadow delivery attempt recorded after terminal outcome/,
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow attempt history rejects a retry started before its scheduled availability", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-attempt-retry-lineage-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    initializeRolloutSchema(db, "2026-08-02T04:00:00.000Z");
    insertOutboxMessage(db);
    db.prepare(`
      INSERT INTO shadow_delivery_attempts
      (delivery_attempt_id, outbox_message_id, attempt_no, outcome, error_code,
       started_at, completed_at, next_available_at, created_at)
      VALUES ('attempt-1', 'message-1', 1, 'retryable_failure', 'FIXTURE', ?, ?, ?, ?)
    `).run(
      "2026-08-02T04:00:01.000Z",
      "2026-08-02T04:00:02.000Z",
      "2026-08-02T04:01:00.000Z",
      "2026-08-02T04:00:02.000Z",
    );
    db.prepare(`
      INSERT INTO shadow_delivery_attempts
      (delivery_attempt_id, outbox_message_id, attempt_no, outcome, error_code,
       started_at, completed_at, next_available_at, created_at)
      VALUES ('attempt-2', 'message-1', 2, 'succeeded', NULL, ?, ?, NULL, ?)
    `).run(
      "2026-08-02T04:00:30.000Z",
      "2026-08-02T04:00:31.000Z",
      "2026-08-02T04:00:31.000Z",
    );

    assert.throws(
      () => assertShadowDeliveryAttemptHistory(db),
      /shadow delivery attempt started before retry schedule/,
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
