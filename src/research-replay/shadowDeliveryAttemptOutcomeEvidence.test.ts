import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { assertShadowDeliveryAttemptHistory } from "./shadowDeliveryAttemptEvidence";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

function withAttempt(
  outcome: "succeeded" | "retryable_failure" | "permanent_failure",
  errorCode: string | null,
  run: (dbPath: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "shadow-attempt-outcome-"));
  const dbPath = join(root, "sidecar.sqlite");
  const db = openRolloutDatabase(dbPath);
  try {
    const now = "2026-08-02T03:00:00.000Z";
    initializeRolloutSchema(db, now);
    const payload = { id: 1 };
    db.prepare(`
      INSERT INTO shadow_outbox_messages
      (outbox_message_id, idempotency_key, message_type, payload_json,
       payload_hash, enqueued_at, available_at, created_at)
      VALUES ('message-1', 'message-1-key', 'fixture.v1', ?, ?, ?, ?, ?)
    `).run(JSON.stringify(payload), canonicalHash(payload), now, now, now);
    db.prepare(`
      INSERT INTO shadow_delivery_attempts
      (delivery_attempt_id, outbox_message_id, attempt_no, outcome, error_code,
       started_at, completed_at, next_available_at, created_at)
      VALUES ('attempt-1', 'message-1', 1, ?, ?, ?, ?, NULL, ?)
    `).run(outcome, errorCode, now, "2026-08-02T03:00:01.000Z", "2026-08-02T03:00:01.000Z");
    db.close();
    run(dbPath);
  } finally {
    try { db.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true });
  }
}

test("failed shadow delivery attempt requires persisted error evidence", () => {
  withAttempt("permanent_failure", null, (dbPath) => {
    const db = openRolloutDatabase(dbPath);
    try {
      assert.throws(
        () => assertShadowDeliveryAttemptHistory(db, "2026-08-02T04:00:00.000Z"),
        /failed shadow delivery attempt missing error_code/,
      );
    } finally {
      db.close();
    }
  });
});

test("successful shadow delivery attempt rejects contradictory error evidence", () => {
  withAttempt("succeeded", "SHADOW_RETRY_EXHAUSTED", (dbPath) => {
    const db = openRolloutDatabase(dbPath);
    try {
      assert.throws(
        () => assertShadowDeliveryAttemptHistory(db, "2026-08-02T04:00:00.000Z"),
        /successful shadow delivery attempt must not have error_code/,
      );
    } finally {
      db.close();
    }
  });
});
