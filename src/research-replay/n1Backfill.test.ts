import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalHash } from "./canonical";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import {
  BackfillCheckpointRepository,
  initializeN1BackfillSchema,
  initializeN1SettlementSchema,
  N1_BACKFILL_MIGRATION_CHECKSUM,
  N1_BACKFILL_SCHEMA_VERSION,
  N1_SETTLEMENT_PARSER_VERSION,
  verifyN1BackfillSchema,
  verifyN1SettlementSchema,
} from "./settlement";
import {
  classifyRaceLines,
  listArchiveFiles,
  requireBackfillParseRunContract,
  resolveStatus,
  runBackfill,
} from "./n1Backfill";
import {
  parseOfficialResultDetail,
  parseOfficialResultDetailLegacyV1ForAudit,
} from "../domain/officialResultDetailParser";
import { compareRefundSemantics } from "./n1RefundSemanticsAudit";

const NOW = "2026-07-25T04:00:00.000Z";
const ARCHIVE_ROOT = join("data", "raw", "official", "results");

function setup() {
  const root = mkdtempSync(join(tmpdir(), "n1-backfill-test-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  db.exec("PRAGMA synchronous = OFF;");
  initializeSidecarSchema(db, NOW);
  return { root, db };
}

test("n1-settlement.0.2 is an expand-only add on top of 0.1 (0.1 unchanged, checkpoint append-only)", () => {
  const { db } = setup();
  initializeN1SettlementSchema(db, NOW);
  assert.equal(verifyN1SettlementSchema(db).ok, true);
  assert.equal(verifyN1SettlementSchema(db).appendOnlyTriggerCount, 14);

  initializeN1BackfillSchema(db, NOW);
  // 0.1は不変。
  assert.equal(verifyN1SettlementSchema(db).ok, true);
  assert.equal(verifyN1SettlementSchema(db).appendOnlyTriggerCount, 14);
  const backfill = verifyN1BackfillSchema(db);
  assert.equal(backfill.ok, true);
  assert.equal(backfill.version, N1_BACKFILL_SCHEMA_VERSION);
  assert.equal(backfill.checksumMatches, true);
  assert.equal(backfill.appendOnlyTriggerCount, 2);
  assert.equal((db.prepare("PRAGMA foreign_key_check").all()).length, 0);
  // append-only。
  db.prepare(`INSERT INTO n1_settlement_backfill_checkpoints
    (checkpoint_id,archive_file,source_archive_sha256,parser_version,source_schema_family,
     first_race_key,last_race_key,expected_race_count,parsed_race_count,candidate_count,
     payout_line_count,refund_line_count,transaction_batch_size,resume_token,state,
     retry_count,failure_reason,migration_version,created_at,completed_at)
    VALUES ('c1','k000101.lzh',?,'v1','official_archive',NULL,NULL,0,0,0,0,0,1,NULL,'completed',0,NULL,?,?,?)`)
    .run("0".repeat(64), N1_BACKFILL_SCHEMA_VERSION, NOW, NOW);
  assert.throws(() => db.prepare("UPDATE n1_settlement_backfill_checkpoints SET state='failed'").run(), /append-only/);
  db.close();
});

test("backfill migration checksum mismatch is default-deny", () => {
  const { db } = setup();
  initializeN1SettlementSchema(db, NOW);
  db.prepare(`INSERT INTO n1_schema_migrations VALUES (?,?,?,?,?,'partial')`)
    .run("bad", N1_BACKFILL_SCHEMA_VERSION, "0".repeat(64), NOW, process.version);
  assert.throws(() => initializeN1BackfillSchema(db, NOW), /checksum mismatch/);
  assert.notEqual(N1_BACKFILL_MIGRATION_CHECKSUM, "0".repeat(64));
  db.close();
});

test("backfill parse-run retry rejects immutable lineage drift", () => {
  const { root, db } = setup();
  const rawStore = new RawStore(join(root, "raw"));
  const replay = new ResearchReplayRepository(db, rawStore, undefined, () => NOW);
  const raw = replay.recordRawDocument({ bytes: Buffer.from("archive-fixture"), contentType: "text/plain", charset: "shift_jis" });
  const parseRunId = `n1bf-parse-${raw.rawDocumentId}`;
  const semanticPayloadHash = canonicalHash({ file: "k260101.lzh" });
  db.prepare(`
    INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind,
     correction_reason, created_at)
    VALUES (?, ?, 'n1-backfill-archive', 'stale-parser-v0', 'modern_seven_display',
            'rr-c14n-v1', 'settlement_result', 'success', '[]', NULL,
            ?, ?, ?, NULL, NULL, NULL, ?)
  `).run(parseRunId, raw.rawDocumentId, NOW, NOW, semanticPayloadHash, NOW);
  assert.throws(() => requireBackfillParseRunContract({
    db,
    parseRunId,
    rawDocumentId: raw.rawDocumentId,
    sourceSchemaVersion: "modern_seven_display",
    semanticPayloadHash,
  }), /N1_BACKFILL_PARSE_RUN_CONFLICT/);
  db.close();
});

test("backfill parse-run retry accepts the exact immutable lineage", () => {
  const { root, db } = setup();
  const rawStore = new RawStore(join(root, "raw"));
  const replay = new ResearchReplayRepository(db, rawStore, undefined, () => NOW);
  const raw = replay.recordRawDocument({ bytes: Buffer.from("archive-fixture"), contentType: "text/plain", charset: "shift_jis" });
  const parseRunId = `n1bf-parse-${raw.rawDocumentId}`;
  const semanticPayloadHash = canonicalHash({ file: "k260101.lzh" });
  db.prepare(`
    INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind,
     correction_reason, created_at)
    VALUES (?, ?, 'n1-backfill-archive', ?, 'modern_seven_display',
            'rr-c14n-v1', 'settlement_result', 'success', '[]', NULL,
            ?, ?, ?, NULL, NULL, NULL, ?)
  `).run(parseRunId, raw.rawDocumentId, N1_SETTLEMENT_PARSER_VERSION, NOW, NOW, semanticPayloadHash, NOW);
  assert.doesNotThrow(() => requireBackfillParseRunContract({
    db,
    parseRunId,
    rawDocumentId: raw.rawDocumentId,
    sourceSchemaVersion: "modern_seven_display",
    semanticPayloadHash,
  }));
  db.close();
});

test("checkpoint repository is event-sourced: latest state wins, completedCount counts distinct files", () => {
  const { db } = setup();
  initializeN1SettlementSchema(db, NOW);
  initializeN1BackfillSchema(db, NOW);
  let seq = 0;
  const repo = new BackfillCheckpointRepository(db, () => `cp-${++seq}`);
  const base = {
    sourceArchiveSha256: "a".repeat(64), parserVersion: "v1", sourceSchemaFamily: "official_archive",
    firstRaceKey: null, lastRaceKey: null, expectedRaceCount: 0, parsedRaceCount: 0, candidateCount: 0,
    payoutLineCount: 0, refundLineCount: 0, transactionBatchSize: 1000, resumeToken: null,
    retryCount: 0, failureReason: null, createdAt: NOW, completedAt: null,
  };
  repo.record({ ...base, archiveFile: "k1.lzh", state: "failed", createdAt: "2026-07-25T04:00:00.000Z" });
  repo.record({ ...base, archiveFile: "k1.lzh", state: "completed", retryCount: 1, createdAt: "2026-07-25T04:05:00.000Z", completedAt: "2026-07-25T04:05:00.000Z" });
  repo.record({ ...base, archiveFile: "k2.lzh", state: "failed", createdAt: "2026-07-25T04:06:00.000Z" });
  assert.equal(repo.isCompleted("k1.lzh"), true);
  assert.equal(repo.isCompleted("k2.lzh"), false);
  assert.equal(repo.latest("k1.lzh")?.retryCount, 1);
  assert.equal(repo.completedCount(), 1);
  db.close();
});

test("backfill executor ingests sample files, writes zero evidence pins (Option B), and is idempotent", { skip: !existsSync(ARCHIVE_ROOT) }, async () => {
  const { root, db } = setup();
  initializeN1SettlementSchema(db, NOW);
  initializeN1BackfillSchema(db, NOW);
  const rawStore = new RawStore(join(root, "raw"));
  const files = listArchiveFiles(ARCHIVE_ROOT).slice(0, 2);
  const first = await runBackfill({ db, rawStore, archiveFiles: files, now: NOW, maxFiles: 2 });
  assert.equal(first.processedFiles, 2);
  assert.ok(first.candidates > 0);
  // Option B: candidateはあってもexplicit pinは0。
  const pins = Number((db.prepare("SELECT COUNT(*) c FROM settlement_evidence_pins_v2").get() as { c: number }).c);
  assert.equal(pins, 0);
  const candidatesAfterFirst = Number((db.prepare("SELECT COUNT(*) c FROM settlement_candidates_v2").get() as { c: number }).c);
  // 冪等: 再実行はcheckpoint completedをskipし、candidateは増えない。
  const second = await runBackfill({ db, rawStore, archiveFiles: files, now: NOW, maxFiles: 2 });
  assert.equal(second.skippedCompleted, 2);
  assert.equal(second.processedFiles, 0);
  const candidatesAfterSecond = Number((db.prepare("SELECT COUNT(*) c FROM settlement_candidates_v2").get() as { c: number }).c);
  assert.equal(candidatesAfterSecond, candidatesAfterFirst);
  assert.equal((db.prepare("PRAGMA foreign_key_check").all()).length, 0);
  db.close();
});


test("archive special payout stays bet-type scoped and does not contaminate later payout lines", () => {
  const source = [
    "桐生［成績］",
    "ボートレース桐生 2026/ 6/ 30",
    " 1R 予選 H1800m 晴 風 北 1m 波 1cm",
    "単勝     特払い     70",
    "２連単   1-2   500   人気   1",
    "３連単   1-2-3   1,200   人気   2",
  ].join("\n");

  const defaults = { date: "2026-06-30", fetchedAt: NOW };
  const parsed = parseOfficialResultDetail(source, defaults);
  const legacy = parseOfficialResultDetailLegacyV1ForAudit(source, defaults);

  assert.equal(N1_SETTLEMENT_PARSER_VERSION, "n1-settlement-parser-v2");
  assert.equal(parsed.conditions.length, 1);
  assert.equal(parsed.conditions[0].returned, false);

  const special = parsed.payouts.find((line) => line.betType === "win");
  assert.ok(special);
  assert.equal(special.combination, "特払");
  assert.equal(special.payoutYen, 70);
  assert.equal(special.returned, false);

  const exacta = parsed.payouts.find((line) => line.betType === "exacta");
  const trifecta = parsed.payouts.find((line) => line.betType === "trifecta");
  assert.ok(exacta);
  assert.ok(trifecta);
  assert.equal(exacta.returned, false);
  assert.equal(trifecta.returned, false);

  const bucket = classifyRaceLines("win", [special]);
  assert.equal(bucket.refunds.length, 0);
  assert.deepEqual(bucket.payouts, [{
    selection: "特払",
    payoutYen: 70,
    popularity: null,
    lineKind: "special_payout",
  }]);
  assert.equal(resolveStatus(bucket), "settled");

  assert.equal(legacy.payouts.some((line) => line.betType === "win"), false);
  assert.equal(legacy.payouts.find((line) => line.betType === "exacta")?.returned, true);
  assert.equal(legacy.payouts.find((line) => line.betType === "trifecta")?.returned, true);

  const comparison = compareRefundSemantics(legacy, parsed);
  assert.deepEqual(
    comparison.changedRows.map((row) => [row.betType, row.eventKind]),
    [
      ["exacta", "false_refund_reclassified"],
      ["trifecta", "false_refund_reclassified"],
      ["win", "special_payout_added"],
    ],
  );
  assert.equal(comparison.legacyRefundCandidates, 2);
  assert.equal(comparison.currentRefundCandidates, 0);
  assert.equal(comparison.currentSpecialPayoutCandidates, 1);
});

test("archive no-contest remains a race-wide return sentinel", () => {
  const source = [
    "桐生［成績］",
    "ボートレース桐生 2026/ 6/ 30",
    " 1R 予選 H1800m 晴 風 北 1m 波 1cm",
    "不成立",
    "単勝     1     100",
  ].join("\n");

  const parsed = parseOfficialResultDetail(source, {
    date: "2026-06-30",
    fetchedAt: NOW,
  });

  assert.equal(parsed.conditions[0].returned, true);
  assert.equal(parsed.payouts[0].returned, true);
  const bucket = classifyRaceLines("win", parsed.payouts);
  assert.equal(bucket.payouts.length, 0);
  assert.equal(bucket.refunds.length, 1);
  assert.equal(resolveStatus(bucket), "refunded");
});
