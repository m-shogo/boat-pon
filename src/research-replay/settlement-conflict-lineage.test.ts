import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository, type FixtureEnvelope } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { initializeN1SettlementSchema, SettlementRepository, type SettlementBetType } from "./settlement";

const NOW = "2026-07-24T03:00:00.000Z";
const RACE_A = "2026-07-24:01:R1";
const RACE_B = "2026-07-24:01:R2";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-conflict-lineage-"));
  const db = openSidecarDatabase(join(root, "temp.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  let sequence = 0;
  const replay = new ResearchReplayRepository(
    db,
    new RawStore(join(root, "raw")),
    () => `lineage-${++sequence}`,
    () => NOW,
  );
  return { db, replay, settlement: new SettlementRepository(db, () => `lineage-${++sequence}`) };
}

function ingest(ctx: ReturnType<typeof setup>, name: string, race: string) {
  const envelope: FixtureEnvelope = {
    sourceSchemaVersion: "fixture-envelope-v1",
    payloadType: "settlement_result",
    canonicalRaceKey: race,
    payload: {
      canonicalRaceKey: race,
      sourceKind: "synthetic_fixture",
      parseStatus: "success",
      candidateCount: 1,
      diagnosticCodes: [],
      fixtureName: name,
    },
    sourcePublishedAt: "2026-07-24T02:59:00.000Z",
    sourceObservedAt: NOW,
    firstSeenAt: NOW,
    timingQuality: "source_exact",
    sourceQuality: "sanitized_fixture",
    measurementQuality: "synthetic_contract",
    effectiveAt: NOW,
    warningCodes: [],
  };
  const bytes = Buffer.from(JSON.stringify(envelope));
  const capture = ctx.replay.createCaptureAttempt({
    logicalRequestGroupId: `fixture-${name}`,
    canonicalRaceKey: race,
    sourceUrl: `https://fixture.invalid/${name}`,
    method: "LOCAL_FIXTURE",
    requestStartedAt: NOW,
    sourceType: "synthetic_fixture",
  });
  ctx.replay.addCaptureEvent({ captureAttemptId: capture, eventKind: "capture_started", occurredAt: NOW });
  const body = ctx.replay.addCaptureEvent({
    captureAttemptId: capture, eventKind: "body_completed", occurredAt: NOW, byteCount: bytes.length,
  });
  const raw = ctx.replay.recordRawDocument({ bytes, contentType: "application/json", charset: "utf-8" });
  ctx.replay.linkCaptureToRaw({ captureAttemptId: capture, rawDocumentId: raw.rawDocumentId, bodyCompletedEventId: body, linkedAt: NOW });
  const parsed = ctx.replay.parseFixtureEnvelope({
    rawDocumentId: raw.rawDocumentId,
    parserVersion: "rr-parser-n1-v1",
    expectedSourceSchemaVersion: "fixture-envelope-v1",
  });
  return { raw, parsed };
}

function append(ctx: ReturnType<typeof setup>, name: string, race: string, betType: SettlementBetType, payoutYen: number) {
  const evidence = ingest(ctx, name, race);
  const selection = betType === "win" || betType === "place" ? "1"
    : betType === "trifecta" || betType === "trio" ? "1-2-3" : "1-2";
  return ctx.settlement.appendCandidate({
    canonicalRaceKey: race,
    betType,
    settlementStatus: "settled",
    resultKind: "normal",
    revisionKind: "initial",
    resolutionStatus: "unresolved",
    sourceKind: "synthetic_fixture",
    sourceSchemaVersion: "fixture-v1",
    observationId: evidence.parsed.observationId!,
    parseRunId: evidence.parsed.parseRunId,
    rawDocumentId: evidence.raw.rawDocumentId,
    observedAt: NOW,
    payouts: [{ selection, payoutYen }],
  });
}

test("settlement conflicts fail closed before writes when candidate race or bet lineage differs", () => {
  const ctx = setup();
  const first = append(ctx, "race-a-source-a", RACE_A, "exacta", 500);
  const second = append(ctx, "race-a-source-b", RACE_A, "exacta", 510);
  const otherRace = append(ctx, "race-b", RACE_B, "exacta", 520);
  const otherBet = append(ctx, "race-a-win", RACE_A, "win", 100);

  assert.throws(() => ctx.settlement.createConflict({
    canonicalRaceKey: RACE_A,
    betType: "exacta",
    candidateIds: [first.candidateId, otherRace.candidateId],
    reason: "CROSS_RACE_FORGERY",
    createdAt: NOW,
  }), /CONFLICT_CANDIDATE_RACE_MISMATCH/);
  assert.throws(() => ctx.settlement.createConflict({
    canonicalRaceKey: RACE_A,
    betType: "exacta",
    candidateIds: [first.candidateId, otherBet.candidateId],
    reason: "CROSS_BET_FORGERY",
    createdAt: NOW,
  }), /CONFLICT_CANDIDATE_BET_TYPE_MISMATCH/);

  assert.equal((ctx.db.prepare("SELECT COUNT(*) count FROM settlement_conflict_groups_v2").get() as { count: number }).count, 0);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) count FROM settlement_conflict_members_v2").get() as { count: number }).count, 0);

  const valid = ctx.settlement.createConflict({
    canonicalRaceKey: RACE_A,
    betType: "exacta",
    candidateIds: [first.candidateId, second.candidateId],
    reason: "PAYOUT_MISMATCH",
    createdAt: NOW,
  });
  assert.ok(valid);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) count FROM settlement_conflict_groups_v2").get() as { count: number }).count, 1);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) count FROM settlement_conflict_members_v2").get() as { count: number }).count, 2);
  ctx.db.close();
});
