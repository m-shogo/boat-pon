import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalHash, sha256Bytes } from "./canonical";
import {
  enqueueOfficialProgramShadow,
  N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
} from "./n2OfficialProgramShadow";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { DEFAULT_ROLLOUT_CONFIG, RolloutController } from "./rollout";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

function programRaw(): string {
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

test("official program shadow refuses an immutable payload collision on an existing idempotency key", () => {
  const root = mkdtempSync(join(tmpdir(), "official-shadow-idempotency-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    const now = "2004-01-01T01:05:00.000Z";
    initializeRolloutSchema(db, now);
    const rawStore = new RawStore(join(root, "raw"));
    let sequence = 0;
    const repository = new ResearchReplayRepository(db, rawStore, () => `idem-${++sequence}`, () => now);
    const controller = new RolloutController(
      db,
      repository,
      rawStore,
      () => `idem-${++sequence}`,
      () => now,
      () => Number.MAX_SAFE_INTEGER,
    );
    controller.recordConfig({
      ...DEFAULT_ROLLOUT_CONFIG,
      shadowWriteEnabled: true,
      storageQuotaBytes: 1024 * 1024 * 1024,
      diskLowWaterBytes: 0,
    }, "test-only enable");

    const rawJson = programRaw();
    const requestStartedAt = "2004-01-01T01:01:58.000Z";
    const raceKey = "2004-01-01:01:R1";
    const idempotencyKey = [
      N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
      raceKey,
      requestStartedAt,
      sha256Bytes(Buffer.from(rawJson, "utf8")),
    ].join(":");
    const conflictingPayload = { stale: true };
    db.prepare(`
      INSERT INTO shadow_outbox_messages
      (outbox_message_id, idempotency_key, message_type, payload_json,
       payload_hash, enqueued_at, available_at, created_at)
      VALUES ('existing-message', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      idempotencyKey,
      N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
      JSON.stringify(conflictingPayload),
      canonicalHash(conflictingPayload),
      now,
      now,
      now,
    );

    assert.throws(() => enqueueOfficialProgramShadow(controller, {
      primaryRecordId: "official-program-row-1",
      logicalRequestGroupId: "program-20040101-01-01",
      canonicalRaceKey: raceKey,
      sourceUrl: "https://example.invalid/program?race=1",
      requestStartedAt,
      responseHeadersReceivedAt: "2004-01-01T01:01:59.000Z",
      bodyCompletedAt: "2004-01-01T01:02:00.000Z",
      sourcePublishedAt: "2004-01-01T01:00:00.000Z",
      sourceObservedAt: "2004-01-01T01:02:00.000Z",
      firstSeenAt: "2004-01-01T01:03:00.000Z",
      rawJson,
      httpStatus: 200,
      responseHeaders: { "content-type": "application/json" },
    }), /official program shadow idempotency key already belongs to different immutable payload/);

    const count = db.prepare("SELECT COUNT(*) count FROM shadow_outbox_messages").get() as { count: number };
    assert.equal(count.count, 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
