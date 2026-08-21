import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RawStore } from "./rawStore";
import { ResearchReplayRepository, type FixtureEnvelope } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { initializeN1SettlementSchema, SettlementRepository } from "./settlement";

const NOW = "2026-08-21T07:00:00.000Z";
const LATER = "2026-08-21T08:00:00.000Z";
const RACE = "2026-08-21:05:R1";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-settlement-reuse-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  let sequence = 0;
  const replay = new ResearchReplayRepository(
    db,
    new RawStore(join(root, "raw")),
    () => `reuse-${++sequence}`,
    () => NOW,
  );
  const envelope: FixtureEnvelope = {
    sourceSchemaVersion: "fixture-envelope-v1",
    payloadType: "settlement_result",
    canonicalRaceKey: RACE,
    payload: {
      canonicalRaceKey: RACE,
      sourceKind: "synthetic_fixture",
      parseStatus: "success",
      candidateCount: 1,
      diagnosticCodes: [],
    },
    sourcePublishedAt: NOW,
    sourceObservedAt: NOW,
    firstSeenAt: NOW,
    timingQuality: "source_exact",
    sourceQuality: "sanitized_fixture",
    measurementQuality: "synthetic_contract",
    effectiveAt: NOW,
    warningCodes: [],
  };
  const bytes = Buffer.from(JSON.stringify(envelope));
  const captureAttemptId = replay.createCaptureAttempt({
    logicalRequestGroupId: "settlement-reuse-lineage",
    canonicalRaceKey: RACE,
    sourceUrl: "https://fixture.invalid/settlement-reuse-lineage",
    method: "LOCAL_FIXTURE",
    requestStartedAt: NOW,
    sourceType: "synthetic_fixture",
  });
  replay.addCaptureEvent({ captureAttemptId, eventKind: "capture_started", occurredAt: NOW });
  const bodyCompletedEventId = replay.addCaptureEvent({
    captureAttemptId,
    eventKind: "body_completed",
    occurredAt: NOW,
    byteCount: bytes.length,
  });
  const raw = replay.recordRawDocument({ bytes, contentType: "application/json", charset: "utf-8" });
  replay.linkCaptureToRaw({ captureAttemptId, rawDocumentId: raw.rawDocumentId, bodyCompletedEventId, linkedAt: NOW });
  const parsed = replay.parseFixtureEnvelope({
    rawDocumentId: raw.rawDocumentId,
    parserVersion: "rr-parser-settlement-reuse-v1",
    expectedSourceSchemaVersion: "fixture-envelope-v1",
  });
  assert.ok(parsed.observationId);
  return {
    db,
    settlement: new SettlementRepository(db, () => `candidate-${++sequence}`),
    rawDocumentId: raw.rawDocumentId,
    parseRunId: parsed.parseRunId,
    observationId: parsed.observationId,
  };
}

function input(ctx: ReturnType<typeof setup>) {
  return {
    canonicalRaceKey: RACE,
    betType: "win" as const,
    settlementStatus: "settled" as const,
    resultKind: "normal" as const,
    revisionKind: "initial" as const,
    resolutionStatus: "resolved" as const,
    sourceKind: "synthetic_fixture",
    sourceSchemaVersion: "fixture-v1",
    observationId: ctx.observationId!,
    parseRunId: ctx.parseRunId,
    rawDocumentId: ctx.rawDocumentId,
    observedAt: NOW,
    payouts: [{ selection: "1", payoutYen: 100 }],
  };
}

test("settlement candidate exact retry remains idempotent across execution times", () => {
  const ctx = setup();
  const first = ctx.settlement.appendCandidate(input(ctx));
  const retry = ctx.settlement.appendCandidate({ ...input(ctx), observedAt: LATER });
  assert.equal(first.inserted, true);
  assert.equal(retry.inserted, false);
  assert.equal(retry.candidateId, first.candidateId);
  ctx.db.close();
});

test("settlement candidate retry rejects immutable lineage drift", () => {
  const ctx = setup();
  ctx.settlement.appendCandidate(input(ctx));
  assert.throws(
    () => ctx.settlement.appendCandidate({
      ...input(ctx),
      resolutionStatus: "quarantined",
      sourceSchemaVersion: "fixture-v2",
    }),
    /SETTLEMENT_CANDIDATE_REUSE_CONFLICT/,
  );
  assert.equal(
    Number((ctx.db.prepare("SELECT COUNT(*) AS count FROM settlement_candidates_v2").get() as { count: number }).count),
    1,
  );
  ctx.db.close();
});
