import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  enqueueOfficialProgramShadow,
  handleOfficialProgramShadowMessage,
  N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
} from "./n2OfficialProgramShadow";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { DEFAULT_ROLLOUT_CONFIG, RolloutController } from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";
import { ShadowMessageRouter } from "./shadowMessageRouter";

function rawJson(): string {
  return JSON.stringify({ boats: Array.from({ length: 6 }, (_, index) => ({
    course: index + 1,
    registrationNo: String(4000 + index),
    className: index === 0 ? "A1" : "B1",
    nationalWinRate: 6 + index / 10,
    nationalTop2Rate: 40 + index,
    localWinRate: 5 + index / 10,
    localTop2Rate: 35 + index,
    motorTop2Rate: 30 + index,
    boatTop2Rate: 28 + index,
  })) });
}

function shadowInput() {
  return {
    primaryRecordId: "program-row-1",
    logicalRequestGroupId: "program-20040101-01-01",
    canonicalRaceKey: "2004-01-01:01:R1",
    sourceUrl: "https://example.invalid/program?token=secret",
    requestStartedAt: "2004-01-01T01:01:58Z",
    responseHeadersReceivedAt: "2004-01-01T01:01:59Z",
    bodyCompletedAt: "2004-01-01T01:02:00Z",
    sourcePublishedAt: "2004-01-01T01:00:00Z",
    sourceObservedAt: "2004-01-01T01:02:00Z",
    firstSeenAt: "2004-01-01T01:03:00Z",
    rawJson: rawJson(),
    httpStatus: 200,
    responseHeaders: { "content-type": "application/json" },
  };
}

function context(maxRetries = 3) {
  const dir = mkdtempSync(join(tmpdir(), "shadow-router-"));
  const db = openRolloutDatabase(join(dir, "sidecar.sqlite"));
  initializeRolloutSchema(db, "2004-01-01T01:00:00Z");
  let sequence = 0;
  let now = "2004-01-01T01:05:00.000Z";
  const rawStore = new RawStore(join(dir, "raw"));
  const repository = new ResearchReplayRepository(db, rawStore, () => `id-${++sequence}`, () => now);
  const controller = new RolloutController(
    db,
    repository,
    rawStore,
    () => `id-${++sequence}`,
    () => now,
    () => Number.MAX_SAFE_INTEGER,
  );
  controller.recordConfig({
    ...DEFAULT_ROLLOUT_CONFIG,
    shadowWriteEnabled: true,
    maxRetries,
    storageQuotaBytes: 1024 * 1024 * 1024,
    diskLowWaterBytes: 0,
  }, "temp mixed shadow router test");
  return {
    dir, db, repository, controller,
    setNow(value: string) { now = value; },
    close() { db.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

test("mixed message types are delivered only to their registered handlers", () => {
  const ctx = context();
  try {
    enqueueOfficialProgramShadow(ctx.controller, shadowInput());
    ctx.controller.enqueue({
      idempotencyKey: "fixture-message-1",
      messageType: "fixture.health.v1",
      payload: { check: "ok" },
    });
    let fixtureDeliveries = 0;
    const router = new ShadowMessageRouter()
      .register(N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE, (message) => {
        handleOfficialProgramShadowMessage({
          repository: ctx.repository,
          messageType: message.messageType,
          payload: message.payload,
          loadPrimaryRaw: (id) => id === "program-row-1" ? rawJson() : null,
        });
      })
      .register("fixture.health.v1", (message) => {
        assert.deepEqual(message.payload, { check: "ok" });
        fixtureDeliveries += 1;
      });
    assert.deepEqual(ctx.controller.drain(router.handle), {
      succeeded: 2, retrying: 0, permanentlyFailed: 0,
    });
    assert.equal(fixtureDeliveries, 1);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM capture_attempts").get() as { n: number }).n, 1);
  } finally { ctx.close(); }
});

test("unknown message type becomes permanent failure on its first attempt", () => {
  const ctx = context(10);
  try {
    ctx.controller.enqueue({
      idempotencyKey: "unknown-1",
      messageType: "unknown.contract.v1",
      payload: { value: 1 },
    });
    const result = ctx.controller.drain(new ShadowMessageRouter().handle);
    assert.deepEqual(result, { succeeded: 0, retrying: 0, permanentlyFailed: 1 });
    const row = ctx.db.prepare(`
      SELECT attempt_no, outcome, error_code, next_available_at FROM shadow_delivery_attempts
    `).get() as { attempt_no: number; outcome: string; error_code: string; next_available_at: string | null };
    assert.deepEqual({ ...row }, {
      attempt_no: 1,
      outcome: "permanent_failure",
      error_code: "SHADOW_MESSAGE_TYPE_UNSUPPORTED",
      next_available_at: null,
    });
    assert.deepEqual(ctx.controller.drain(new ShadowMessageRouter().handle), {
      succeeded: 0, retrying: 0, permanentlyFailed: 0,
    });
  } finally { ctx.close(); }
});

test("malformed known payload is permanent before capture evidence", () => {
  const ctx = context(10);
  try {
    ctx.controller.enqueue({
      idempotencyKey: "malformed-program-1",
      messageType: N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
      payload: { version: "wrong" },
    });
    const router = new ShadowMessageRouter().register(
      N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
      (message) => handleOfficialProgramShadowMessage({
        repository: ctx.repository,
        messageType: message.messageType,
        payload: message.payload,
        loadPrimaryRaw: () => rawJson(),
      }),
    );
    assert.deepEqual(ctx.controller.drain(router.handle), {
      succeeded: 0, retrying: 0, permanentlyFailed: 1,
    });
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM capture_attempts").get() as { n: number }).n, 0);
    const row = ctx.db.prepare("SELECT error_code FROM shadow_delivery_attempts").get() as { error_code: string };
    assert.equal(row.error_code, "OFFICIAL_PROGRAM_SHADOW_PAYLOAD_INVALID");
  } finally { ctx.close(); }
});

test("transient handler failure still retries and later succeeds", () => {
  const ctx = context();
  try {
    ctx.controller.enqueue({
      idempotencyKey: "transient-1",
      messageType: "fixture.transient.v1",
      payload: { value: 1 },
    });
    let calls = 0;
    const router = new ShadowMessageRouter().register("fixture.transient.v1", () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary unavailable");
    });
    assert.deepEqual(ctx.controller.drain(router.handle), {
      succeeded: 0, retrying: 1, permanentlyFailed: 0,
    });
    ctx.setNow("2004-01-01T01:05:01.000Z");
    assert.deepEqual(ctx.controller.drain(router.handle), {
      succeeded: 1, retrying: 0, permanentlyFailed: 0,
    });
    assert.equal(calls, 2);
  } finally { ctx.close(); }
});

test("rollback kill switch leaves queued messages untouched and stops delivery", () => {
  const ctx = context();
  try {
    enqueueOfficialProgramShadow(ctx.controller, shadowInput());
    const stopped = ctx.controller.rollback("temp shadow canary rollback");
    assert.equal(stopped.shadowWriteEnabled, false);
    assert.equal(stopped.killSwitchEngaged, true);
    let deliveries = 0;
    assert.deepEqual(ctx.controller.drain(() => { deliveries += 1; }), {
      succeeded: 0, retrying: 0, permanentlyFailed: 0,
    });
    assert.equal(deliveries, 0);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM shadow_outbox_messages").get() as { n: number }).n, 1);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM shadow_delivery_attempts").get() as { n: number }).n, 0);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM capture_attempts").get() as { n: number }).n, 0);
  } finally { ctx.close(); }
});
