import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { DEFAULT_ROLLOUT_CONFIG, RolloutController } from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

test("operational GC rejects invalid bounds before selecting or deleting raw evidence", (t) => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-gc-bound-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const db = openRolloutDatabase(join(root, "research-replay.sqlite"));
  t.after(() => db.close());
  const now = "2026-08-23T00:00:00.000Z";
  initializeRolloutSchema(db, now);
  const rawStore = new RawStore(join(root, "raw"));
  let sequence = 0;
  const repository = new ResearchReplayRepository(
    db,
    rawStore,
    () => `gc-bound-${++sequence}`,
    () => now,
  );
  const controller = new RolloutController(
    db,
    repository,
    rawStore,
    () => `gc-bound-${++sequence}`,
    () => now,
    () => Number.MAX_SAFE_INTEGER,
  );
  const raw = repository.recordRawDocument({
    bytes: Buffer.from("bounded-gc"),
    contentType: "text/plain",
    charset: "utf-8",
  });
  controller.recordConfig({
    ...DEFAULT_ROLLOUT_CONFIG,
    operationalGcEnabled: true,
    storageQuotaBytes: 1,
    diskLowWaterBytes: 0,
  }, "force bounded GC");

  for (const invalid of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => controller.collectUnreferencedRaw(invalid),
      /invalid operational GC maxItems/,
    );
  }

  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM evidence_tombstones").get() as { count: number }).count, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM operational_audit_events WHERE event_kind='gc_intent'").get() as { count: number }).count, 0);
  assert.equal(existsSync(rawStore.absolutePathForHash(raw.rawSha256)), true);

  const zero = controller.collectUnreferencedRaw(0);
  assert.equal(zero.status, "completed");
  assert.deepEqual(zero.deleted, []);
  assert.deepEqual(zero.rejected, []);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM evidence_tombstones").get() as { count: number }).count, 0);
  assert.equal(existsSync(rawStore.absolutePathForHash(raw.rawSha256)), true);
});
