import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { assertShadowDeliveryAttemptHistory } from "./shadowDeliveryAttemptEvidence";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

test("shadow delivery attempt cannot precede the message availability instant", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-attempt-availability-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    initializeRolloutSchema(db, "2026-08-02T03:00:00.000Z");
    const payload = { id: 1 };
    db.prepare(`
      INSERT INTO shadow_outbox_messages
      (outbox_message_id, idempotency_key, message_type, payload_json,
       payload_hash, enqueued_at, available_at, created_at)
      VALUES ('message-1', 'message-1-key', 'fixture.v1', ?, ?, ?, ?, ?)
    `).run(
      JSON.stringify(payload),
      canonicalHash(payload),
      "2026-08-02T03:00:00.000Z",
      "2026-08-02T05:00:00.000Z",
      "2026-08-02T03:00:00.000Z",
    );
    db.prepare(`
      INSERT INTO shadow_delivery_attempts
      (delivery_attempt_id, outbox_message_id, attempt_no, outcome, error_code,
       started_at, completed_at, next_available_at, created_at)
      VALUES ('attempt-1', 'message-1', 1, 'succeeded', NULL, ?, ?, NULL, ?)
    `).run(
      "2026-08-02T04:00:00.000Z",
      "2026-08-02T04:00:01.000Z",
      "2026-08-02T04:00:01.000Z",
    );

    assert.throws(
      () => assertShadowDeliveryAttemptHistory(db, "2026-08-02T06:00:00.000Z"),
      /shadow delivery attempt started before message availability/,
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
