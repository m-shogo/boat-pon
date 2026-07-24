import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository, type FixtureEnvelope } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import {
  BET_TYPES,
  initializeN1SettlementSchema,
  N1_SETTLEMENT_MIGRATION_CHECKSUM,
  N1_SETTLEMENT_SCHEMA_VERSION,
  parseSettlementSelection,
  SettlementRepository,
  verifyN1SettlementSchema,
} from "./settlement";
import { parseOfficialResultDetail } from "../domain/officialResultDetailParser";
import { parseSanitizedOfficialWebResult } from "./settlementWebParser";
import { observationCategory } from "./domain";

const NOW = "2026-07-24T03:00:00.000Z";
const RACE = "2026-07-24:01:R1";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n1-test-"));
  const db = openSidecarDatabase(join(root, "temp.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  let sequence = 0;
  const replay = new ResearchReplayRepository(
    db,
    new RawStore(join(root, "raw")),
    () => `n1-${++sequence}`,
    () => NOW,
  );
  return { root, db, replay, settlement: new SettlementRepository(db, () => `n1-${++sequence}`) };
}

function ingest(ctx: ReturnType<typeof setup>, input: {
  name: string; parseStatus?: "success" | "warning" | "error" | "unsupported_schema";
}) {
  const status = input.parseStatus ?? "success";
  const envelope: FixtureEnvelope = {
    sourceSchemaVersion: status === "unsupported_schema" ? "unsupported-v9" : "fixture-envelope-v1",
    payloadType: status === "error" ? "fixture_only" : status === "unsupported_schema"
      ? "settlement_parse_diagnostic" : "settlement_result",
    canonicalRaceKey: RACE,
    payload: status === "error"
      ? { broken: true }
      : {
          canonicalRaceKey: RACE,
          sourceKind: "synthetic_fixture",
          parseStatus: status,
          candidateCount: ["error", "unsupported_schema"].includes(status) ? 0 : 1,
          diagnosticCodes: status === "warning" ? ["SYNTHETIC_WARNING"] : [],
        },
    sourcePublishedAt: "2026-07-24T02:59:00.000Z",
    sourceObservedAt: NOW,
    firstSeenAt: NOW,
    timingQuality: "source_exact",
    sourceQuality: "sanitized_fixture",
    measurementQuality: "synthetic_contract",
    effectiveAt: NOW,
    warningCodes: status === "warning" ? ["SYNTHETIC_WARNING"] : [],
  };
  const bytes = Buffer.from(JSON.stringify(envelope));
  const capture = ctx.replay.createCaptureAttempt({
    logicalRequestGroupId: `fixture-${input.name}`,
    canonicalRaceKey: RACE,
    sourceUrl: `https://fixture.invalid/${input.name}`,
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

test("N1 temp migration is checksummed, resumable and append-only", () => {
  const ctx = setup();
  assert.deepEqual(verifyN1SettlementSchema(ctx.db), {
    ok: true,
    version: "n1-settlement.0.1",
    checksumMatches: true,
    appendOnlyTriggerCount: 14,
  });
  initializeN1SettlementSchema(ctx.db, NOW);
  assert.equal((ctx.db.prepare("PRAGMA foreign_key_check").all()).length, 0);
  ctx.db.close();
});

test("partial migration resumes by checksum and unknown checksum is default-deny", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n1-partial-"));
  const db = openSidecarDatabase(join(root, "partial.sqlite"));
  initializeSidecarSchema(db, NOW);
  db.exec(`CREATE TABLE n1_schema_migrations (
    migration_id TEXT PRIMARY KEY, migration_version TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL, runtime_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('applied','partial','failed'))
  ) STRICT`);
  db.prepare("INSERT INTO n1_schema_migrations VALUES (?,?,?,?,?,'partial')").run(
    "partial", N1_SETTLEMENT_SCHEMA_VERSION, N1_SETTLEMENT_MIGRATION_CHECKSUM, NOW, process.version,
  );
  initializeN1SettlementSchema(db, NOW);
  assert.equal(verifyN1SettlementSchema(db).ok, true);
  db.close();

  const denied = openSidecarDatabase(join(root, "denied.sqlite"));
  initializeSidecarSchema(denied, NOW);
  denied.exec(`CREATE TABLE n1_schema_migrations (
    migration_id TEXT PRIMARY KEY, migration_version TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL, runtime_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('applied','partial','failed'))
  ) STRICT`);
  denied.prepare("INSERT INTO n1_schema_migrations VALUES (?,?,?,?,?,'partial')").run(
    "bad", N1_SETTLEMENT_SCHEMA_VERSION, "0".repeat(64), NOW, process.version,
  );
  assert.throws(() => initializeN1SettlementSchema(denied, NOW), /checksum mismatch/);
  denied.close();
});

test("7券種selection parser normalizes NFKC/separators and preserves ordering contracts", () => {
  assert.deepEqual(BET_TYPES, ["win", "place", "exacta", "quinella", "trifecta", "trio", "wide"]);
  assert.equal(parseSettlementSelection("exacta", "１→２").canonical, "1-2");
  assert.equal(parseSettlementSelection("quinella", "２／１").canonical, "1-2");
  assert.equal(parseSettlementSelection("trio", "３・１・２").canonical, "1-2-3");
  assert.equal(parseSettlementSelection("trifecta", "3 1 2").canonical, "3-1-2");
  assert.equal(parseSettlementSelection("win", "7").reason, "BOAT_OUT_OF_RANGE");
  assert.equal(parseSettlementSelection("trifecta", "1-1-2").reason, "DUPLICATE_BOAT");
});

test("official K parser extracts all seven bet types including multi-line place/wide", () => {
  const bytes = readFileSync(join("tests", "fixtures", "K260520.TXT"));
  const decoded = new TextDecoder("shift_jis").decode(bytes);
  const result = parseOfficialResultDetail(decoded, { date: "2026-05-20", fetchedAt: NOW });
  assert.deepEqual(new Set(result.payouts.map((line) => line.betType)), new Set(BET_TYPES));
  const firstRace = result.conditions[0].raceId;
  assert.equal(result.payouts.filter((line) => line.raceId === firstRace && line.betType === "place").length, 2);
  assert.equal(result.payouts.filter((line) => line.raceId === firstRace && line.betType === "wide").length, 3);
});

test("sanitized official-Web fixture parser covers seven bet types without network", () => {
  const html = readFileSync(join("tests", "fixtures", "research-replay", "n1-official-web-result.html"), "utf8");
  const parsed = parseSanitizedOfficialWebResult(html);
  assert.equal(parsed.status, "success");
  assert.deepEqual(new Set(parsed.lines.map((line) => line.betType)), new Set(BET_TYPES));
  assert.equal(parsed.lines.filter((line) => line.betType === "place").length, 2);
  assert.equal(parsed.lines.filter((line) => line.betType === "wide").length, 3);
});

test("N1 settlement observations remain post-race leakage sentinels", () => {
  assert.equal(observationCategory("settlement_result"), "post_race");
  assert.equal(observationCategory("settlement_parse_diagnostic"), "post_race");
});

test("20-case fixture records full lineage; parser failures create no candidate", () => {
  const ctx = setup();
  const fixture = JSON.parse(readFileSync(
    join("tests", "fixtures", "research-replay", "n1-settlement-cases.json"), "utf8",
  )) as { cases: Array<{
    id: number; name: string; parseStatus: "success" | "warning" | "error" | "unsupported_schema";
    settlementStatus: "pending" | "settled" | "refunded" | "partially_refunded" | "cancelled" | "no_sale" | null;
    resultKind: "normal" | "dead_heat" | "special_payout" | "source_defined" | "unknown";
    candidateExpected: boolean;
  }> };
  assert.equal(fixture.cases.length, 20);
  for (const item of fixture.cases) {
    const { raw, parsed } = ingest(ctx, item);
    assert.equal(Boolean(parsed.observationId), item.candidateExpected, item.name);
    if (!item.candidateExpected) {
      assert.throws(() => ctx.settlement.appendCandidate({
        canonicalRaceKey: RACE, betType: "win", settlementStatus: "settled", resultKind: "normal",
        revisionKind: "initial", resolutionStatus: "quarantined", sourceKind: "synthetic_fixture",
        sourceSchemaVersion: "fixture-v1", observationId: "missing", parseRunId: parsed.parseRunId,
        rawDocumentId: raw.rawDocumentId, observedAt: NOW, payouts: [{ selection: "1", payoutYen: 100 }],
      }), /PARSE_STATUS_FORBIDS_CANDIDATE/);
      continue;
    }
    const special = item.resultKind === "special_payout";
    const refunds = item.settlementStatus && ["refunded", "partially_refunded", "cancelled"].includes(item.settlementStatus)
      ? [{ scope: "race" as const, refundYenPer100: 100, reasonCode: "SYNTHETIC_REFUND" }]
      : [];
    let betType: typeof BET_TYPES[number] = "win";
    let payouts = item.settlementStatus && ["pending", "refunded", "cancelled", "no_sale"].includes(item.settlementStatus)
      ? []
      : [{ selection: special ? "特払" : "1", payoutYen: special ? 70 : 100, lineKind: special ? "special_payout" as const : "payout" as const }];
    if (item.id === 2) {
      betType = "place";
      payouts = [
        { selection: "1", payoutYen: 100, lineKind: "payout" },
        { selection: "2", payoutYen: 180, lineKind: "payout" },
      ];
    } else if (item.id === 3) {
      betType = "wide";
      payouts = ["1-2", "1-3", "2-3"].map((selection, index) => ({
        selection, payoutYen: 150 + index * 50, lineKind: "payout" as const,
      }));
    } else if (item.id === 4) {
      betType = "exacta";
      payouts = [
        { selection: "1-2", payoutYen: 300, lineKind: "payout" },
        { selection: "2-1", payoutYen: 500, lineKind: "payout" },
      ];
    } else if (item.id === 16) {
      payouts = [
        { selection: "1", payoutYen: 100, lineKind: "payout" },
        { selection: "1", payoutYen: 100, lineKind: "payout" },
      ];
    }
    const first = ctx.settlement.appendCandidate({
      canonicalRaceKey: RACE, betType, settlementStatus: item.settlementStatus!,
      resultKind: item.resultKind, revisionKind: "initial",
      resolutionStatus: item.id === 20 ? "quarantined" : "resolved",
      sourceKind: "synthetic_fixture", sourceSchemaVersion: "fixture-v1",
      observationId: parsed.observationId!, parseRunId: parsed.parseRunId,
      rawDocumentId: raw.rawDocumentId, observedAt: NOW, payouts, refunds,
    });
    const second = ctx.settlement.appendCandidate({
      canonicalRaceKey: RACE, betType, settlementStatus: item.settlementStatus!,
      resultKind: item.resultKind, revisionKind: "initial",
      resolutionStatus: item.id === 20 ? "quarantined" : "resolved",
      sourceKind: "synthetic_fixture", sourceSchemaVersion: "fixture-v1",
      observationId: parsed.observationId!, parseRunId: parsed.parseRunId,
      rawDocumentId: raw.rawDocumentId, observedAt: NOW, payouts, refunds,
    });
    assert.equal(first.candidateId, second.candidateId);
    assert.equal(second.inserted, false);
    if (item.id === 1) {
      for (const extraBetType of BET_TYPES.filter((value) => value !== "win")) {
        const selection = extraBetType === "trifecta" || extraBetType === "trio" ? "1-2-3"
          : extraBetType === "exacta" || extraBetType === "quinella" || extraBetType === "wide" ? "1-2" : "1";
        ctx.settlement.appendCandidate({
          canonicalRaceKey: RACE, betType: extraBetType, settlementStatus: "settled", resultKind: "normal",
          revisionKind: "initial", resolutionStatus: "resolved", sourceKind: "synthetic_fixture",
          sourceSchemaVersion: "fixture-v1", observationId: parsed.observationId!, parseRunId: parsed.parseRunId,
          rawDocumentId: raw.rawDocumentId, observedAt: NOW,
          payouts: [{ selection, payoutYen: 100 }],
        });
      }
    }
  }
  assert.equal((ctx.db.prepare("SELECT COUNT(*) count FROM capture_attempts").get() as { count: number }).count, 20);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) count FROM settlement_candidates_v2").get() as { count: number }).count, 23);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) count FROM settlement_evidence_pins_v2").get() as { count: number }).count, 69);
  assert.equal((ctx.db.prepare(`
    SELECT COUNT(*) count FROM race_payout_lines_v2 p
    JOIN settlement_candidates_v2 c ON c.candidate_id=p.candidate_id
    WHERE c.observation_id=(SELECT observation_id FROM domain_observations ORDER BY rowid LIMIT 1)
  `).get() as { count: number }).count, 7);
  assert.equal((ctx.db.prepare(`
    SELECT COUNT(*) count FROM race_payout_lines_v2 p
    JOIN settlement_candidates_v2 c ON c.candidate_id=p.candidate_id
    WHERE c.bet_type='wide' AND c.source_kind='synthetic_fixture'
  `).get() as { count: number }).count >= 3, true);
  ctx.db.close();
});

test("different source hashes create explicit conflict; corrections require supersession", () => {
  const ctx = setup();
  const a = ingest(ctx, { name: "source-a" });
  const b = ingest(ctx, { name: "source-b", parseStatus: "warning" });
  const first = ctx.settlement.appendCandidate({
    canonicalRaceKey: RACE, betType: "exacta", settlementStatus: "settled", resultKind: "normal",
    revisionKind: "initial", resolutionStatus: "unresolved", sourceKind: "archive", sourceSchemaVersion: "k-v1",
    observationId: a.parsed.observationId!, parseRunId: a.parsed.parseRunId, rawDocumentId: a.raw.rawDocumentId,
    observedAt: NOW, payouts: [{ selection: "1-2", payoutYen: 500 }],
  });
  const second = ctx.settlement.appendCandidate({
    canonicalRaceKey: RACE, betType: "exacta", settlementStatus: "settled", resultKind: "normal",
    revisionKind: "initial", resolutionStatus: "source_conflict", sourceKind: "web", sourceSchemaVersion: "web-v1",
    observationId: b.parsed.observationId!, parseRunId: b.parsed.parseRunId, rawDocumentId: b.raw.rawDocumentId,
    observedAt: NOW, payouts: [{ selection: "1-2", payoutYen: 510 }],
  });
  const conflict = ctx.settlement.createConflict({
    canonicalRaceKey: RACE, betType: "exacta", candidateIds: [first.candidateId, second.candidateId],
    reason: "PAYOUT_MISMATCH", createdAt: NOW,
  });
  assert.ok(conflict);
  ctx.settlement.appendResolutionEvent({
    conflictGroupId: conflict!, eventKind: "manual_resolution", selectedCandidateId: first.candidateId,
    reason: "synthetic fixture adjudication", actor: "test", occurredAt: NOW,
  });
  assert.throws(() => ctx.db.prepare("UPDATE settlement_resolution_events_v2 SET actor='x'").run(), /append-only/);
  assert.throws(() => ctx.db.prepare("UPDATE settlement_candidates_v2 SET source_kind='x'").run(), /append-only/);
  assert.throws(() => ctx.settlement.appendCandidate({
    canonicalRaceKey: RACE, betType: "exacta", settlementStatus: "settled", resultKind: "normal",
    revisionKind: "official_correction", resolutionStatus: "resolved", sourceKind: "web", sourceSchemaVersion: "web-v2",
    observationId: b.parsed.observationId!, parseRunId: b.parsed.parseRunId, rawDocumentId: b.raw.rawDocumentId,
    observedAt: NOW, payouts: [{ selection: "1-2", payoutYen: 520 }],
  }), /REVISION_REQUIRES/);
  const correction = ctx.settlement.appendCandidate({
    canonicalRaceKey: RACE, betType: "exacta", settlementStatus: "settled", resultKind: "normal",
    revisionKind: "official_correction", resolutionStatus: "resolved", sourceKind: "web", sourceSchemaVersion: "web-v2",
    observationId: b.parsed.observationId!, parseRunId: b.parsed.parseRunId, rawDocumentId: b.raw.rawDocumentId,
    observedAt: NOW, payouts: [{ selection: "1-2", payoutYen: 520 }],
    supersedesCandidateId: second.candidateId, correctionReason: "official correction fixture",
  });
  assert.equal(correction.inserted, true);
  ctx.db.close();
});
