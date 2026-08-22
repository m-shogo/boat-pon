import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { RolloutController } from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

test("GC recovery rejects raw evidence that became referenced after intent", (t) => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-gc-recovery-reference-"));
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
    () => `gc-recovery-${++sequence}`,
    () => now,
  );
  const controller = new RolloutController(
    db,
    repository,
    rawStore,
    () => `gc-recovery-${++sequence}`,
    () => now,
  );
  const raw = repository.recordRawDocument({
    bytes: Buffer.from("referenced-after-intent"),
    contentType: "text/plain",
    charset: "utf-8",
  });

  db.prepare(`
    INSERT INTO operational_audit_events
    (audit_event_id, operation_id, event_kind, subject_type, subject_id,
     detail_json, occurred_at, created_at)
    VALUES (?, ?, 'gc_intent', 'raw_document', ?, '{}', ?, ?)
  `).run("gc-intent-event", "gc-reference-drift", raw.rawDocumentId, now, now);
  repository.recordTombstone({
    evidenceType: "raw_document",
    evidenceId: raw.rawDocumentId,
    reason: "operational_gc_unreferenced",
    recordedAt: now,
  });

  const attempt = repository.createCaptureAttempt({
    logicalRequestGroupId: "reference-drift",
    sourceUrl: "https://fixture.invalid/reference-drift",
    method: "LOCAL_FIXTURE",
    requestStartedAt: now,
    sourceType: "sanitized_fixture",
  });
  const completed = repository.addCaptureEvent({
    captureAttemptId: attempt,
    eventKind: "body_completed",
    occurredAt: now,
    byteCount: Buffer.byteLength("referenced-after-intent"),
  });
  repository.linkCaptureToRaw({
    captureAttemptId: attempt,
    rawDocumentId: raw.rawDocumentId,
    bodyCompletedEventId: completed,
    linkedAt: now,
  });

  assert.deepEqual(controller.recoverGcIntents(), []);
  assert.equal(existsSync(rawStore.absolutePathForHash(raw.rawSha256)), true);
  const rejected = db.prepare(`
    SELECT COUNT(*) AS count
    FROM operational_audit_events
    WHERE operation_id='gc-reference-drift' AND event_kind='gc_rejected'
  `).get() as { count: number };
  assert.equal(rejected.count, 1);

  assert.deepEqual(controller.recoverGcIntents(), []);
  const rejectedAfterRetry = db.prepare(`
    SELECT COUNT(*) AS count
    FROM operational_audit_events
    WHERE operation_id='gc-reference-drift' AND event_kind='gc_rejected'
  `).get() as { count: number };
  assert.equal(rejectedAfterRetry.count, 1);
  assert.equal(existsSync(rawStore.absolutePathForHash(raw.rawSha256)), true);
});
