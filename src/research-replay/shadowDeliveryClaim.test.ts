import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { DEFAULT_ROLLOUT_CONFIG, RolloutController } from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

function testContext() {
  const dir = mkdtempSync(join(tmpdir(), "shadow-delivery-claim-"));
  const dbPath = join(dir, "sidecar.sqlite");
  const rawRoot = join(dir, "raw");
  const dbA = openRolloutDatabase(dbPath);
  initializeRolloutSchema(dbA, "2026-08-02T01:00:00Z");
  let sequence = 0;
  const now = () => "2026-08-02T01:05:00.000Z";
  const rawStoreA = new RawStore(rawRoot);
  const repositoryA = new ResearchReplayRepository(dbA, rawStoreA, () => `a-${++sequence}`, now);
  const controllerA = new RolloutController(
    dbA, repositoryA, rawStoreA, () => `a-${++sequence}`, now, () => Number.MAX_SAFE_INTEGER,
  );
  controllerA.recordConfig({
    ...DEFAULT_ROLLOUT_CONFIG,
    shadowWriteEnabled: true,
    storageQuotaBytes: 1024 * 1024 * 1024,
    diskLowWaterBytes: 0,
  }, "temp delivery claim test");

  const dbB = openRolloutDatabase(dbPath);
  dbB.exec("PRAGMA busy_timeout = 1");
  const rawStoreB = new RawStore(rawRoot);
  const repositoryB = new ResearchReplayRepository(dbB, rawStoreB, () => `b-${++sequence}`, now);
  const controllerB = new RolloutController(
    dbB, repositoryB, rawStoreB, () => `b-${++sequence}`, now, () => Number.MAX_SAFE_INTEGER,
  );
  return {
    dbA, dbB, controllerA, controllerB,
    close() {
      dbB.close();
      dbA.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("two consumers cannot deliver the same outbox message concurrently", () => {
  const ctx = testContext();
  try {
    ctx.controllerA.enqueue({
      idempotencyKey: "claim-message-1",
      messageType: "fixture.claim.v1",
      payload: { value: 1 },
    });
    let deliveriesA = 0;
    let deliveriesB = 0;
    const resultA = ctx.controllerA.drain(() => {
      const nested = ctx.controllerB.drainWithDiagnostics(() => { deliveriesB += 1; });
      assert.deepEqual(nested, {
        succeeded: 0,
        retrying: 0,
        permanentlyFailed: 0,
        examined: 1,
        contended: 1,
        skippedAfterClaim: 0,
        handlerDeadlineExceeded: 0,
      });
      deliveriesA += 1;
    });
    assert.deepEqual(resultA, { succeeded: 1, retrying: 0, permanentlyFailed: 0 });
    assert.equal(deliveriesA, 1);
    assert.equal(deliveriesB, 0);
    assert.equal((ctx.dbA.prepare("SELECT COUNT(*) n FROM shadow_delivery_attempts").get() as { n: number }).n, 1);
    assert.deepEqual(ctx.controllerB.drain(() => { deliveriesB += 1; }), {
      succeeded: 0, retrying: 0, permanentlyFailed: 0,
    });
    assert.equal(deliveriesB, 0);
  } finally { ctx.close(); }
});

test("a failed handler records one retry attempt and cannot be raced", () => {
  const ctx = testContext();
  try {
    ctx.controllerA.enqueue({
      idempotencyKey: "claim-message-2",
      messageType: "fixture.claim.v1",
      payload: { value: 2 },
    });
    let nestedDeliveries = 0;
    const result = ctx.controllerA.drain(() => {
      ctx.controllerB.drain(() => { nestedDeliveries += 1; });
      throw new Error("temporary failure");
    });
    assert.deepEqual(result, { succeeded: 0, retrying: 1, permanentlyFailed: 0 });
    assert.equal(nestedDeliveries, 0);
    const attempts = ctx.dbA.prepare(`
      SELECT attempt_no, outcome FROM shadow_delivery_attempts ORDER BY attempt_no
    `).all() as Array<{ attempt_no: number; outcome: string }>;
    assert.deepEqual(attempts.map((row) => ({ ...row })), [
      { attempt_no: 1, outcome: "retryable_failure" },
    ]);
  } finally { ctx.close(); }
});
