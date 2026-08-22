import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalHash } from "./canonical";
import { buildShadowOperabilityReport, type ShadowOperabilityThresholds } from "./shadowOperability";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

const permissiveThresholds: ShadowOperabilityThresholds = {
  maxQueued: 10,
  maxReadyQueued: 10,
  maxOldestQueuedAgeMs: 60_000,
  maxRetrying: 10,
  maxPermanentlyFailed: 10,
  maxRetryExhausted: 10,
  maxContentionRate: 1,
  maxHandlerDeadlineExceeded: 10,
};

function withDatabase(run: (db: ReturnType<typeof openRolloutDatabase>) => void): void {
  const root = mkdtempSync(join(tmpdir(), "shadow-operability-payload-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    initializeRolloutSchema(db, "2026-08-22T17:40:00.000Z");
    run(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function insertOutbox(
  db: ReturnType<typeof openRolloutDatabase>,
  payloadJson: string,
  payloadHash: string,
): void {
  db.prepare(`
    INSERT INTO shadow_outbox_messages
    (outbox_message_id, idempotency_key, message_type, payload_json,
     payload_hash, enqueued_at, available_at, created_at)
    VALUES ('payload-fixture', 'payload-fixture', 'fixture.v1', ?, ?, ?, ?, ?)
  `).run(
    payloadJson,
    payloadHash,
    "2026-08-22T17:40:00.000Z",
    "2026-08-22T17:40:00.000Z",
    "2026-08-22T17:40:00.000Z",
  );
}

function build(db: ReturnType<typeof openRolloutDatabase>) {
  return buildShadowOperabilityReport(db, {
    policyVersion: "fixture-payload-v1",
    asOf: "2026-08-22T17:40:01.000Z",
    diagnosticsWindowMs: 60_000,
    thresholds: permissiveThresholds,
  });
}

test("shadow operability fails closed when persisted payload hash is stale", () => {
  withDatabase((db) => {
    insertOutbox(db, JSON.stringify({ id: 2 }), canonicalHash({ id: 1 }));
    assert.throws(() => build(db), /shadow outbox payload hash mismatch/);
  });
});

test("shadow operability accepts producer-consistent persisted payload integrity", () => {
  withDatabase((db) => {
    const payload = { id: 1 };
    insertOutbox(db, JSON.stringify(payload), canonicalHash(payload));
    const report = build(db);
    assert.equal(report.status, "PASS");
    assert.equal(report.metrics.queued, 1);
  });
});
