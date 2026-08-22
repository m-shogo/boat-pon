import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256Bytes } from "./canonical";
import {
  handleOfficialProgramShadowMessage,
  N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
  N2_OFFICIAL_PROGRAM_SHADOW_PAYLOAD_VERSION,
} from "./n2OfficialProgramShadow";
import { allowlistedHeaders, RawStore, redactSourceUrl } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
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

function payload(rawJson: string) {
  return {
    version: N2_OFFICIAL_PROGRAM_SHADOW_PAYLOAD_VERSION,
    primaryRecordId: "official-program-row-1",
    logicalRequestGroupId: "program-20040101-01-01",
    canonicalRaceKey: "2004-01-01:01:R1",
    sourceUrl: redactSourceUrl("https://example.invalid/program?race=1"),
    requestStartedAt: "2004-01-01T01:01:58.000Z",
    responseHeadersReceivedAt: "2004-01-01T01:01:59.000Z",
    bodyCompletedAt: "2004-01-01T01:02:00.000Z",
    sourcePublishedAt: "2004-01-01T01:00:00.000Z",
    sourceObservedAt: "2004-01-01T01:02:00.000Z",
    firstSeenAt: "2004-01-01T01:03:00.000Z",
    expectedRawSha256: sha256Bytes(Buffer.from(rawJson, "utf8")),
    httpStatus: 200,
    responseHeaders: allowlistedHeaders({ "content-type": "application/json" }),
  };
}

test("official program shadow rejects invalid persisted metadata before primary raw access", () => {
  const root = mkdtempSync(join(tmpdir(), "official-shadow-payload-preflight-"));
  const db = openRolloutDatabase(join(root, "sidecar.sqlite"));
  try {
    const now = "2004-01-01T01:05:00.000Z";
    initializeRolloutSchema(db, now);
    const rawStore = new RawStore(join(root, "raw"));
    let sequence = 0;
    const repository = new ResearchReplayRepository(db, rawStore, () => `preflight-${++sequence}`, () => now);
    const rawJson = programRaw();
    const cases = [
      { ...payload(rawJson), sourceObservedAt: "2004-01-01T24:00:00.000Z" },
      { ...payload(rawJson), httpStatus: 999 },
      { ...payload(rawJson), canonicalRaceKey: "2004-02-30:01:R1" },
      { ...payload(rawJson), sourceUrl: "file:///tmp/official-program.json" },
      { ...payload(rawJson), sourceUrl: "ftp://example.invalid/program" },
    ];

    for (const invalid of cases) {
      let primaryRawReads = 0;
      assert.throws(() => handleOfficialProgramShadowMessage({
        repository,
        messageType: N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
        payload: invalid,
        loadPrimaryRaw: () => {
          primaryRawReads += 1;
          return rawJson;
        },
      }), /OFFICIAL_PROGRAM_SHADOW_PAYLOAD_INVALID|official program shadow (metadata|reference integrity) invalid/);
      assert.equal(primaryRawReads, 0);
    }
    assert.equal((db.prepare("SELECT COUNT(*) count FROM raw_documents").get() as { count: number }).count, 0);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
