import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { DEFAULT_ROLLOUT_CONFIG, RolloutController } from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

test("shadow drain never delivers a payload whose persisted hash is stale", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-outbox-integrity-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    const now = "2026-08-02T04:00:00.000Z";
    initializeRolloutSchema(db, now);
    const rawStore = new RawStore(join(root, "raw"));
    let sequence = 0;
    const repository = new ResearchReplayRepository(
      db,
      rawStore,
      () => `payload-${++sequence}`,
      () => now,
    );
    const controller = new RolloutController(
      db,
      repository,
      rawStore,
      () => `payload-${++sequence}`,
      () => now,
      () => Number.MAX_SAFE_INTEGER,
    );
    controller.recordConfig({
      ...DEFAULT_ROLLOUT_CONFIG,
      shadowWriteEnabled: true,
      diskLowWaterBytes: 0,
    }, "test-only enable");

    db.prepare(`
      INSERT INTO shadow_outbox_messages
      (outbox_message_id, idempotency_key, message_type, payload_json,
       payload_hash, enqueued_at, available_at, created_at)
      VALUES ('message-1', 'message-key-1', 'fixture.v1', ?, ?, ?, ?, ?)
    `).run(
      JSON.stringify({ race: "2026-08-02:01:R1", value: "tampered" }),
      "a".repeat(64),
      now,
      now,
      now,
    );

    let delivered = 0;
    const result = controller.drain(() => {
      delivered += 1;
    }, 1);

    assert.equal(delivered, 0);
    assert.deepEqual(result, { succeeded: 0, retrying: 0, permanentlyFailed: 1 });
    const attempt = db.prepare(`
      SELECT outcome, error_code AS errorCode
      FROM shadow_delivery_attempts
      WHERE outbox_message_id='message-1'
    `).get() as { outcome: string; errorCode: string | null };
    assert.deepEqual(attempt, {
      outcome: "permanent_failure",
      errorCode: "SHADOW_PAYLOAD_HASH_MISMATCH",
    });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
