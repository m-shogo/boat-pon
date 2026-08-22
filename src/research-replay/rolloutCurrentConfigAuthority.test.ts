import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import {
  DEFAULT_ROLLOUT_CONFIG,
  RolloutController,
  type RolloutConfig,
} from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

function context(): {
  db: ReturnType<typeof openRolloutDatabase>;
  controller: RolloutController;
  close(): void;
} {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-rollout-config-authority-"));
  const db = openRolloutDatabase(join(root, "research-replay.sqlite"));
  initializeRolloutSchema(db, "2026-08-23T00:00:00.000Z");
  const rawStore = new RawStore(join(root, "raw"));
  let sequence = 0;
  const repository = new ResearchReplayRepository(
    db,
    rawStore,
    () => `rollout-authority-${++sequence}`,
    () => "2026-08-23T00:00:00.000Z",
  );
  const controller = new RolloutController(
    db,
    repository,
    rawStore,
    () => `rollout-authority-${++sequence}`,
    () => "2026-08-23T00:00:00.000Z",
    () => Number.MAX_SAFE_INTEGER,
  );
  return {
    db,
    controller,
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function config(overrides: Partial<RolloutConfig> = {}): RolloutConfig {
  return {
    ...DEFAULT_ROLLOUT_CONFIG,
    diskLowWaterBytes: 0,
    ...overrides,
  };
}

test("runtime rollout config preserves same-timestamp rowid last-write-wins semantics", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const occurredAt = "2026-08-23T00:00:00.000Z";
  ctx.controller.recordConfig(
    config({ shadowWriteEnabled: true }),
    "enable shadow",
    occurredAt,
    "rollout-config-enable",
  );
  const expected = config({ shadowWriteEnabled: false, killSwitchEngaged: true });
  ctx.controller.recordConfig(
    expected,
    "kill shadow",
    occurredAt,
    "rollout-config-kill",
  );

  assert.deepEqual(ctx.controller.currentConfig(), expected);
  const result = ctx.controller.enqueue({ idempotencyKey: "must-not-write", messageType: "fixture", payload: {} });
  assert.equal(result.status, "killed");
  const row = ctx.db.prepare("SELECT COUNT(*) AS count FROM shadow_outbox_messages").get() as { count: number };
  assert.equal(row.count, 0);
});

test("runtime rollout config rejects non-canonical historical timestamps before latest-state selection", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  ctx.db.prepare(`
    INSERT INTO rollout_config_events
    (config_event_id, shadow_write_enabled, operational_gc_enabled, kill_switch_engaged,
     queue_capacity, max_retries, storage_quota_bytes, disk_low_water_bytes,
     reason, occurred_at, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "rollout-config-invalid-time",
    0,
    0,
    0,
    100,
    3,
    1024 * 1024,
    0,
    "invalid historical timestamp",
    "2026-08-22T24:00:00.000Z",
    "2026-08-23T00:00:00.000Z",
  );
  ctx.controller.recordConfig(
    config(),
    "clean later event",
    "2026-08-23T01:00:00.000Z",
    "rollout-config-later",
  );

  assert.throws(
    () => ctx.controller.currentConfig(),
    /timestamp/,
  );
});

test("runtime rollout config rejects producer-invalid historical flags before latest-state selection", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  ctx.db.prepare(`
    INSERT INTO rollout_config_events
    (config_event_id, shadow_write_enabled, operational_gc_enabled, kill_switch_engaged,
     queue_capacity, max_retries, storage_quota_bytes, disk_low_water_bytes,
     reason, occurred_at, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "rollout-config-invalid-flag",
    2,
    0,
    0,
    100,
    3,
    1024 * 1024,
    0,
    "invalid historical flag",
    "2026-08-23T00:00:00.000Z",
    "2026-08-23T00:00:00.000Z",
  );
  ctx.controller.recordConfig(
    config(),
    "clean later event",
    "2026-08-23T01:00:00.000Z",
    "rollout-config-later",
  );

  assert.throws(
    () => ctx.controller.currentConfig(),
    /invalid rollout config flag/,
  );
});

test("identical full rollout configs may share the latest timestamp", (t) => {
  const ctx = context();
  t.after(() => ctx.close());
  const expected = config({ shadowWriteEnabled: true, queueCapacity: 7, maxRetries: 2 });
  const occurredAt = "2026-08-23T00:00:00.000Z";
  ctx.controller.recordConfig(expected, "first identical event", occurredAt, "rollout-config-a");
  ctx.controller.recordConfig(expected, "second identical event", occurredAt, "rollout-config-b");

  assert.deepEqual(ctx.controller.currentConfig(), expected);
});