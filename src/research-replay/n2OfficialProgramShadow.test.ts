import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  enqueueOfficialProgramShadow,
  handleOfficialProgramShadowMessage,
  N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
  runPrimaryWithOfficialProgramShadow,
} from "./n2OfficialProgramShadow";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { DEFAULT_ROLLOUT_CONFIG, RolloutController } from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

function programRaw(rate = 6): string {
  return JSON.stringify({ boats: Array.from({ length: 6 }, (_, index) => ({
    course: index + 1,
    registrationNo: String(4000 + index),
    className: index === 0 ? "A1" : "B1",
    nationalWinRate: rate + index / 10,
    nationalTop2Rate: 40 + index,
    localWinRate: 5 + index / 10,
    localTop2Rate: 35 + index,
    motorTop2Rate: 30 + index,
    boatTop2Rate: 28 + index,
  })) });
}

function context() {
  const dir = mkdtempSync(join(tmpdir(), "n2-program-shadow-"));
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
  return {
    dir, db, repository, controller,
    enable(queueCapacity = 100) {
      controller.recordConfig({
        ...DEFAULT_ROLLOUT_CONFIG,
        shadowWriteEnabled: true,
        queueCapacity,
        storageQuotaBytes: 1024 * 1024 * 1024,
        diskLowWaterBytes: 0,
      }, "temp official program shadow test");
    },
    setNow(value: string) { now = value; },
    close() { db.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

function captureInput(rawJson = programRaw(), requestStartedAt = "2004-01-01T01:01:58Z") {
  return {
    primaryRecordId: "official-program-row-1",
    logicalRequestGroupId: "program-20040101-01-01",
    canonicalRaceKey: "2004-01-01:01:R1",
    sourceUrl: "https://example.invalid/program?race=1&token=secret",
    requestStartedAt,
    responseHeadersReceivedAt: requestStartedAt === "2004-01-01T01:01:58Z"
      ? "2004-01-01T01:01:59Z" : "2004-01-01T01:02:59Z",
    bodyCompletedAt: requestStartedAt === "2004-01-01T01:01:58Z"
      ? "2004-01-01T01:02:00Z" : "2004-01-01T01:03:00Z",
    sourcePublishedAt: "2004-01-01T01:00:00Z",
    sourceObservedAt: requestStartedAt === "2004-01-01T01:01:58Z"
      ? "2004-01-01T01:02:00Z" : "2004-01-01T01:03:00Z",
    firstSeenAt: requestStartedAt === "2004-01-01T01:01:58Z"
      ? "2004-01-01T01:03:00Z" : "2004-01-01T01:04:00Z",
    rawJson,
    httpStatus: 200,
    responseHeaders: { "content-type": "application/json", authorization: "secret" },
  };
}

test("shadow default OFF leaves primary success and sidecar empty", () => {
  const ctx = context();
  try {
    const result = runPrimaryWithOfficialProgramShadow({
      controller: ctx.controller,
      primary: () => "official-program-row-1",
      shadowInput: () => captureInput(),
    });
    assert.equal(result.primaryResult, "official-program-row-1");
    assert.equal(result.shadowAttempted, false);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM shadow_outbox_messages").get() as { n: number }).n, 0);
  } finally { ctx.close(); }
});

test("outbox stores a sanitized immutable reference and exact retry is idempotent", () => {
  const ctx = context();
  try {
    ctx.enable();
    const first = enqueueOfficialProgramShadow(ctx.controller, captureInput());
    const duplicate = enqueueOfficialProgramShadow(ctx.controller, captureInput());
    assert.equal(first.status, "enqueued");
    assert.equal(duplicate.status, "existing");
    assert.equal(duplicate.outboxMessageId, first.outboxMessageId);
    const row = ctx.db.prepare("SELECT message_type, payload_json FROM shadow_outbox_messages").get() as {
      message_type: string; payload_json: string;
    };
    assert.equal(row.message_type, N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE);
    assert.equal(row.payload_json.includes(programRaw()), false);
    assert.equal(row.payload_json.includes("secret"), false);
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    assert.equal(payload.primaryRecordId, "official-program-row-1");
    assert.equal(typeof payload.expectedRawSha256, "string");
    assert.deepEqual(payload.responseHeaders, { "content-type": "application/json" });
  } finally { ctx.close(); }
});

test("single outbox delivery closes byte-exact lineage and will not redeliver", () => {
  const ctx = context();
  try {
    ctx.enable();
    const source = new Map([["official-program-row-1", programRaw()]]);
    enqueueOfficialProgramShadow(ctx.controller, captureInput());
    const first = ctx.controller.drain((message) => handleOfficialProgramShadowMessage({
      repository: ctx.repository,
      messageType: message.messageType,
      payload: message.payload,
      loadPrimaryRaw: (id) => source.get(id) ?? null,
    }));
    const second = ctx.controller.drain(() => { throw new Error("must not redeliver"); });
    assert.deepEqual(first, { succeeded: 1, retrying: 0, permanentlyFailed: 0 });
    assert.deepEqual(second, { succeeded: 0, retrying: 0, permanentlyFailed: 0 });
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM capture_attempts").get() as { n: number }).n, 1);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM raw_documents").get() as { n: number }).n, 1);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM domain_observations").get() as { n: number }).n, 1);
  } finally { ctx.close(); }
});

test("primary raw mutation fails closed before any capture evidence is written", () => {
  const ctx = context();
  try {
    ctx.enable();
    enqueueOfficialProgramShadow(ctx.controller, captureInput());
    const result = ctx.controller.drain((message) => handleOfficialProgramShadowMessage({
      repository: ctx.repository,
      messageType: message.messageType,
      payload: message.payload,
      loadPrimaryRaw: () => programRaw(7),
    }));
    assert.deepEqual(result, { succeeded: 0, retrying: 1, permanentlyFailed: 0 });
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM capture_attempts").get() as { n: number }).n, 0);
    const delivery = ctx.db.prepare("SELECT error_code FROM shadow_delivery_attempts").get() as { error_code: string };
    assert.equal(delivery.error_code, "OFFICIAL_PROGRAM_SHADOW_SOURCE_INVALID");
  } finally { ctx.close(); }
});

test("backpressure and retry attempts never propagate into primary collector result", () => {
  const ctx = context();
  try {
    ctx.enable(1);
    ctx.controller.enqueue({ idempotencyKey: "occupied", messageType: "fixture", payload: { ok: true } });
    const isolated = runPrimaryWithOfficialProgramShadow({
      controller: ctx.controller,
      primary: () => "primary-success",
      shadowInput: () => captureInput(),
    });
    assert.equal(isolated.primaryResult, "primary-success");
    assert.equal(isolated.shadowAttempted, true);
    assert.equal(isolated.shadowSucceeded, false);
    assert.equal(isolated.shadowErrorCode, "OFFICIAL_PROGRAM_SHADOW_ENQUEUE_REJECTED");

    ctx.controller.recordConfig({
      ...DEFAULT_ROLLOUT_CONFIG,
      shadowWriteEnabled: true,
      queueCapacity: 100,
      storageQuotaBytes: 1024 * 1024 * 1024,
      diskLowWaterBytes: 0,
    }, "allow retry attempts");
    const first = enqueueOfficialProgramShadow(ctx.controller, captureInput());
    const retry = enqueueOfficialProgramShadow(
      ctx.controller,
      captureInput(programRaw(), "2004-01-01T01:02:58Z"),
    );
    assert.equal(first.status, "enqueued");
    assert.equal(retry.status, "enqueued");
    assert.notEqual(first.outboxMessageId, retry.outboxMessageId);
  } finally { ctx.close(); }
});
