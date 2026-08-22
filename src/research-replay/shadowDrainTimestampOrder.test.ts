import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { DEFAULT_ROLLOUT_CONFIG, RolloutController } from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

test("shadow drain rejects non-canonical persisted availability before handler execution", () => {
  const root = mkdtempSync(join(tmpdir(), "shadow-drain-timestamp-order-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    const now = "2026-08-02T04:00:00.000Z";
    initializeRolloutSchema(db, now);
    const rawStore = new RawStore(join(root, "raw"));
    let sequence = 0;
    const repository = new ResearchReplayRepository(db, rawStore, () => `timestamp-${++sequence}`, () => now);
    const controller = new RolloutController(
      db,
      repository,
      rawStore,
      () => `timestamp-${++sequence}`,
      () => now,
      () => Number.MAX_SAFE_INTEGER,
    );
    controller.recordConfig({
      ...DEFAULT_ROLLOUT_CONFIG,
      shadowWriteEnabled: true,
      diskLowWaterBytes: 0,
    }, "fixture-only shadow timestamp validation");

    const payload = { id: 1 };
    db.prepare(`
      INSERT INTO shadow_outbox_messages
      (outbox_message_id, idempotency_key, message_type, payload_json,
       payload_hash, enqueued_at, available_at, created_at)
      VALUES ('message-1', 'message-1-key', 'fixture.v1', ?, ?, ?, ?, ?)
    `).run(
      JSON.stringify(payload),
      canonicalHash(payload),
      "2026-08-02T00:00:00.000Z",
      "2026-08-02T00:00:00-09:00",
      "2026-08-02T00:00:00.000Z",
    );

    let handlerCalls = 0;
    assert.throws(
      () => controller.drainWithDiagnostics(() => { handlerCalls += 1; }, 1),
      /non-canonical shadow outbox available_at/,
    );
    assert.equal(handlerCalls, 0);
    const attemptCount = db.prepare("SELECT COUNT(*) count FROM shadow_delivery_attempts").get() as { count: number };
    assert.equal(attemptCount.count, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
