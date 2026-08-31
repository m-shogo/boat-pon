import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository, type FixtureEnvelope } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { initializeN1SettlementSchema, SettlementRepository } from "./settlement";

const NOW = "2026-07-24T03:00:00.000Z";
const RACE = "2026-07-24:01:R1";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-settlement-producer-lineage-"));
  const db = openSidecarDatabase(join(root, "temp.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  let sequence = 0;
  const replay = new ResearchReplayRepository(
    db,
    new RawStore(join(root, "raw")),
    () => `producer-lineage-${++sequence}`,
    () => NOW,
  );
  return { db, replay, settlement: new SettlementRepository(db, () => `producer-lineage-${++sequence}`) };
}

function ingest(ctx: ReturnType<typeof setup>, name: string) {
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
    logicalRequestGroupId: `producer-lineage-${name}`,
    canonicalRaceKey: RACE,
    sourceUrl: `https://fixture.invalid/${name}`,
    method: "LOCAL_FIXTURE",
    requestStartedAt: NOW,
    sourceType: "synthetic_fixture",
  });
  ctx.replay.addCaptureEvent({ captureAttemptId: capture, eventKind: "capture_started", occurredAt: NOW });
  const body = ctx.replay.addCaptureEvent({
    captureAttemptId: capture,
    eventKind: "body_completed",
    occurredAt: NOW,
    byteCount: bytes.length,
  });
  const raw = ctx.replay.recordRawDocument({ bytes, contentType: "application/json", charset: "utf-8" });
  ctx.replay.linkCaptureToRaw({
    captureAttemptId: capture,
    rawDocumentId: raw.rawDocumentId,
    bodyCompletedEventId: body,
    linkedAt: NOW,
  });
  const parsed = ctx.replay.parseFixtureEnvelope({
    rawDocumentId: raw.rawDocumentId,
    parserVersion: "rr-parser-n1-v1",
    expectedSourceSchemaVersion: "fixture-envelope-v1",
  });
  return { raw, parsed };
}

function appendBase(ctx: ReturnType<typeof setup>, source: ReturnType<typeof ingest>, betType: "win" | "exacta" = "exacta") {
  return ctx.settlement.appendCandidate({
    canonicalRaceKey: RACE,
    betType,
    settlementStatus: "settled",
    resultKind: "normal",
    revisionKind: "initial",
    resolutionStatus: "resolved",
    sourceKind: "synthetic_fixture",
    sourceSchemaVersion: "fixture-v1",
    observationId: source.parsed.observationId!,
    parseRunId: source.parsed.parseRunId,
    rawDocumentId: source.raw.rawDocumentId,
    observedAt: NOW,
    payouts: [{ selection: betType === "win" ? "1" : "1-2", payoutYen: 500 }],
  });
}

test("producer rejects revision metadata on initial candidates", () => {
  const ctx = setup();
  const source = ingest(ctx, "initial-metadata");
  const base = appendBase(ctx, source);

  assert.throws(() => ctx.settlement.appendCandidate({
    canonicalRaceKey: RACE,
    betType: "exacta",
    settlementStatus: "settled",
    resultKind: "normal",
    revisionKind: "initial",
    resolutionStatus: "resolved",
    sourceKind: "synthetic_fixture",
    sourceSchemaVersion: "fixture-v1",
    observationId: source.parsed.observationId!,
    parseRunId: source.parsed.parseRunId,
    rawDocumentId: source.raw.rawDocumentId,
    observedAt: NOW,
    supersedesCandidateId: base.candidateId,
    payouts: [{ selection: "1-2", payoutYen: 510 }],
  }), /INITIAL_REVISION_FORBIDS_SUPERSESSION_OR_REASON/);

  assert.throws(() => ctx.settlement.appendCandidate({
    canonicalRaceKey: RACE,
    betType: "exacta",
    settlementStatus: "settled",
    resultKind: "normal",
    revisionKind: "initial",
    resolutionStatus: "resolved",
    sourceKind: "synthetic_fixture",
    sourceSchemaVersion: "fixture-v1",
    observationId: source.parsed.observationId!,
    parseRunId: source.parsed.parseRunId,
    rawDocumentId: source.raw.rawDocumentId,
    observedAt: NOW,
    correctionReason: "should not exist on initial",
    payouts: [{ selection: "1-2", payoutYen: 510 }],
  }), /INITIAL_REVISION_FORBIDS_SUPERSESSION_OR_REASON/);

  ctx.db.close();
});

test("producer rejects blank reasons and invalid supersession identity", () => {
  const ctx = setup();
  const source = ingest(ctx, "invalid-revision");
  const exacta = appendBase(ctx, source, "exacta");
  const win = appendBase(ctx, source, "win");

  assert.throws(() => ctx.settlement.appendCandidate({
    canonicalRaceKey: RACE,
    betType: "exacta",
    settlementStatus: "settled",
    resultKind: "normal",
    revisionKind: "official_correction",
    resolutionStatus: "resolved",
    sourceKind: "synthetic_fixture",
    sourceSchemaVersion: "fixture-v2",
    observationId: source.parsed.observationId!,
    parseRunId: source.parsed.parseRunId,
    rawDocumentId: source.raw.rawDocumentId,
    observedAt: NOW,
    supersedesCandidateId: exacta.candidateId,
    correctionReason: "   ",
    payouts: [{ selection: "1-2", payoutYen: 510 }],
  }), /REVISION_REQUIRES_SUPERSESSION_AND_REASON/);

  assert.throws(() => ctx.settlement.appendCandidate({
    canonicalRaceKey: RACE,
    betType: "exacta",
    settlementStatus: "settled",
    resultKind: "normal",
    revisionKind: "official_correction",
    resolutionStatus: "resolved",
    sourceKind: "synthetic_fixture",
    sourceSchemaVersion: "fixture-v2",
    observationId: source.parsed.observationId!,
    parseRunId: source.parsed.parseRunId,
    rawDocumentId: source.raw.rawDocumentId,
    observedAt: NOW,
    supersedesCandidateId: "missing-candidate",
    correctionReason: "missing target",
    payouts: [{ selection: "1-2", payoutYen: 510 }],
  }), /SUPERSEDED_CANDIDATE_MISSING/);

  assert.throws(() => ctx.settlement.appendCandidate({
    canonicalRaceKey: RACE,
    betType: "exacta",
    settlementStatus: "settled",
    resultKind: "normal",
    revisionKind: "official_correction",
    resolutionStatus: "resolved",
    sourceKind: "synthetic_fixture",
    sourceSchemaVersion: "fixture-v2",
    observationId: source.parsed.observationId!,
    parseRunId: source.parsed.parseRunId,
    rawDocumentId: source.raw.rawDocumentId,
    observedAt: NOW,
    supersedesCandidateId: win.candidateId,
    correctionReason: "wrong bet lineage",
    payouts: [{ selection: "1-2", payoutYen: 510 }],
  }), /SUPERSESSION_BET_TYPE_MISMATCH/);

  ctx.db.close();
});

test("producer keeps revision retries idempotent and rejects branching successors", () => {
  const ctx = setup();
  const source = ingest(ctx, "branching-revision");
  const base = appendBase(ctx, source);
  const revisionInput = {
    canonicalRaceKey: RACE,
    betType: "exacta" as const,
    settlementStatus: "settled" as const,
    resultKind: "normal" as const,
    revisionKind: "official_correction" as const,
    resolutionStatus: "resolved" as const,
    sourceKind: "synthetic_fixture",
    sourceSchemaVersion: "fixture-v2",
    observationId: source.parsed.observationId!,
    parseRunId: source.parsed.parseRunId,
    rawDocumentId: source.raw.rawDocumentId,
    observedAt: NOW,
    supersedesCandidateId: base.candidateId,
    correctionReason: "official correction fixture",
    payouts: [{ selection: "1-2", payoutYen: 510 }],
  };

  const first = ctx.settlement.appendCandidate(revisionInput);
  const retry = ctx.settlement.appendCandidate(revisionInput);
  assert.equal(retry.inserted, false);
  assert.equal(retry.candidateId, first.candidateId);

  assert.throws(() => ctx.settlement.appendCandidate({
    ...revisionInput,
    sourceSchemaVersion: "fixture-v3",
    correctionReason: "competing branch",
    payouts: [{ selection: "1-2", payoutYen: 520 }],
  }), /SUPERSESSION_ALREADY_HAS_SUCCESSOR/);

  ctx.db.close();
});
