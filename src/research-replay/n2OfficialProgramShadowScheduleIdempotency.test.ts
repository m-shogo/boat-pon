import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash, sha256Bytes } from "./canonical";
import {
  enqueueOfficialProgramShadow,
  N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
  N2_OFFICIAL_PROGRAM_SHADOW_PAYLOAD_VERSION,
} from "./n2OfficialProgramShadow";
import { allowlistedHeaders, RawStore, redactSourceUrl } from "./rawStore";
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

test("official program shadow rejects an existing idempotent payload with delayed availability", () => {
  const root = mkdtempSync(join(tmpdir(), "official-shadow-schedule-idempotency-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    const now = "2004-01-01T01:05:00.000Z";
    initializeRolloutSchema(db, now);
    const rawStore = new RawStore(join(root, "raw"));
    let sequence = 0;
    const repository = new ResearchReplayRepository(db, rawStore, () => `schedule-${++sequence}`, () => now);
    const controller = new RolloutController(
      db,
      repository,
      rawStore,
      () => `schedule-${++sequence}`,
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
    const sourceUrl = "https://example.invalid/program?race=1";
    const payload = {
      version: N2_OFFICIAL_PROGRAM_SHADOW_PAYLOAD_VERSION,
      primaryRecordId: "official-program-row-1",
      logicalRequestGroupId: "program-20040101-01-01",
      canonicalRaceKey: raceKey,
      sourceUrl: redactSourceUrl(sourceUrl),
      requestStartedAt,
      responseHeadersReceivedAt: "2004-01-01T01:01:59.000Z",
      bodyCompletedAt: "2004-01-01T01:02:00.000Z",
      sourcePublishedAt: "2004-01-01T01:00:00.000Z",
      sourceObservedAt: "2004-01-01T01:02:00.000Z",
      firstSeenAt: "2004-01-01T01:03:00.000Z",
      expectedRawSha256: sha256Bytes(Buffer.from(rawJson, "utf8")),
      httpStatus: 200,
      responseHeaders: allowlistedHeaders({ "content-type": "application/json" }),
    };
    const idempotencyKey = [
      N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
      raceKey,
      requestStartedAt,
      payload.expectedRawSha256,
    ].join(":");
    db.prepare(`
      INSERT INTO shadow_outbox_messages
      (outbox_message_id, idempotency_key, message_type, payload_json,
       payload_hash, enqueued_at, available_at, created_at)
      VALUES ('existing-message', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      idempotencyKey,
      N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
      JSON.stringify(payload),
      canonicalHash(payload),
      now,
      "2004-01-01T01:10:00.000Z",
      now,
    );

    assert.throws(() => enqueueOfficialProgramShadow(controller, {
      primaryRecordId: payload.primaryRecordId,
      logicalRequestGroupId: payload.logicalRequestGroupId,
      canonicalRaceKey: raceKey,
      sourceUrl,
      requestStartedAt,
      responseHeadersReceivedAt: payload.responseHeadersReceivedAt,
      bodyCompletedAt: payload.bodyCompletedAt,
      sourcePublishedAt: payload.sourcePublishedAt,
      sourceObservedAt: payload.sourceObservedAt,
      firstSeenAt: payload.firstSeenAt,
      rawJson,
      httpStatus: payload.httpStatus,
      responseHeaders: { "content-type": "application/json" },
    }), /official program shadow idempotency key already belongs to different immutable payload/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
