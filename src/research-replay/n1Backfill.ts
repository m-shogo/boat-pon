// N1-C historical backfill executor（設計 docs/n1-settlement-backfill-design.md）。
// archive file単位のchunkでcandidateを永続sidecarへ投入し、event-sourced checkpointで
// 冪等resumeする。本モジュールは実装＋temp/restore検証用であり、実8,164 backfillは
// 別の明示承認まで起動しない。candidateはOption B（explicit pin無し、candidate FKが暗黙GC pin）。
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "./canonical";
import { semanticPayloadHash } from "./domain";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import {
  BackfillCheckpointRepository,
  BET_TYPES,
  N1_SETTLEMENT_PARSER_VERSION,
  parseSettlementSelection,
  SettlementRepository,
  type SettlementBetType,
  type SettlementStatus,
} from "./settlement";
import {
  parseOfficialResultDetail,
  type RacePayout,
} from "../domain/officialResultDetailParser";

export const N1_BACKFILL_EXECUTOR_VERSION = "n1-backfill-executor-v1";

const VENUE_CODES: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05", 浜名湖: "06",
  蒲郡: "07", 常滑: "08", 津: "09", 三国: "10", びわこ: "11", 住之江: "12",
  尼崎: "13", 鳴門: "14", 丸亀: "15", 児島: "16", 宮島: "17", 徳山: "18",
  下関: "19", 若松: "20", 芦屋: "21", 福岡: "22", 唐津: "23", 大村: "24",
};

function fileDate(path: string): string {
  const match = basename(path).match(/k(\d{2})(\d{2})(\d{2})\.lzh$/i);
  if (!match) return "1970-01-01";
  const year = Number(match[1]) >= 70 ? `19${match[1]}` : `20${match[1]}`;
  return `${year}-${match[2]}-${match[3]}`;
}

export function listArchiveFiles(root: string): string[] {
  const output: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /^k\d{6}\.lzh$/i.test(entry.name)) output.push(path);
    }
  };
  walk(root);
  return output.sort((left, right) => left.localeCompare(right));
}

function unpackToBuffer(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("unar", ["-q", "-o", "-", path], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(Buffer.concat(chunks))
      : reject(new Error(Buffer.concat(errors).toString("utf8") || `unar exit ${code}`)));
  });
}

function schemaFamily(text: string): string {
  return text.includes("３連単") && text.includes("単勝") ? "modern_seven_display"
    : text.includes("連単") ? "legacy_pre_trifecta" : "unknown";
}

type LineBucket = {
  payouts: Array<{ selection: string; payoutYen: number; popularity: number | null; lineKind: "payout" | "special_payout" }>;
  refunds: Array<{ selection: string | null; scope: "selection" | "bet_type" | "race"; refundYenPer100: number | null; reasonCode: string }>;
};

function classifyRaceLines(betType: SettlementBetType, lines: RacePayout[]): LineBucket {
  const bucket: LineBucket = { payouts: [], refunds: [] };
  for (const line of lines) {
    if (line.returned || line.payoutYen === null) {
      const parsed = line.combination ? parseSettlementSelection(betType, line.combination) : null;
      bucket.refunds.push({
        selection: parsed?.valid ? line.combination : null,
        scope: line.combination ? "selection" : "bet_type",
        refundYenPer100: 100, reasonCode: "ARCHIVE_RETURNED",
      });
      continue;
    }
    const parsed = parseSettlementSelection(betType, line.combination);
    bucket.payouts.push(parsed.valid && parsed.canonical
      ? { selection: line.combination, payoutYen: line.payoutYen, popularity: line.popularity, lineKind: "payout" }
      : { selection: line.combination || "特", payoutYen: line.payoutYen, popularity: line.popularity, lineKind: "special_payout" });
  }
  return bucket;
}

function resolveStatus(bucket: LineBucket): SettlementStatus | null {
  const hasPayout = bucket.payouts.length > 0;
  const hasRefund = bucket.refunds.length > 0;
  if (hasPayout && hasRefund) return "partially_refunded";
  if (hasPayout) return "settled";
  if (hasRefund) return "refunded";
  return null;
}

export type ArchiveFileResult = {
  archiveFile: string;
  state: "completed" | "failed";
  parsedRaces: number;
  candidates: number;
  payoutLines: number;
  refundLines: number;
  firstRaceKey: string | null;
  lastRaceKey: string | null;
  failureReason: string | null;
};

// 1 archive fileをsidecarへ投入する。candidateはappendCandidateが内部で1件ずつtransaction化し、
// 同一observation/bet-type/hashはUNIQUEでno-op（冪等）。pinはOption Bで保存しない。
export async function ingestArchiveFile(input: {
  filePath: string;
  replay: ResearchReplayRepository;
  settlement: SettlementRepository;
  db: DatabaseSync;
  now: string;
  idPrefix: string;
}): Promise<ArchiveFileResult> {
  const { filePath, replay, settlement, db, now } = input;
  const file = basename(filePath);
  const result: ArchiveFileResult = {
    archiveFile: file, state: "completed", parsedRaces: 0, candidates: 0,
    payoutLines: 0, refundLines: 0, firstRaceKey: null, lastRaceKey: null, failureReason: null,
  };
  const bytes = await unpackToBuffer(filePath);
  const text = new TextDecoder("shift_jis").decode(bytes);
  const family = schemaFamily(text);
  const parsed = parseOfficialResultDetail(text, { date: fileDate(filePath), fetchedAt: "1970-01-01T00:00:00.000Z" });
  const raw = replay.recordRawDocument({ bytes, contentType: "text/plain", charset: "shift_jis" });
  const parseRunId = `${input.idPrefix}-parse-${raw.rawDocumentId}`;
  db.prepare(`
    INSERT OR IGNORE INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind,
     correction_reason, created_at)
    VALUES (?, ?, 'n1-backfill-archive', ?, ?, 'rr-c14n-v1', 'settlement_result', 'success', '[]', NULL,
            ?, ?, ?, NULL, NULL, NULL, ?)
  `).run(parseRunId, raw.rawDocumentId, N1_SETTLEMENT_PARSER_VERSION, family, now, now, canonicalHash({ file }), now);

  const payoutByRace = new Map<string, RacePayout[]>();
  for (const line of parsed.payouts) {
    const list = payoutByRace.get(line.raceId) ?? [];
    list.push(line);
    payoutByRace.set(line.raceId, list);
  }
  let observationSeq = 0;
  const insertObs = db.prepare(`
    INSERT OR IGNORE INTO domain_observations
    (observation_id, canonical_race_key, observation_type, payload_type, payload_schema_version,
     parse_run_id, raw_document_id, source_published_at, source_observed_at, first_seen_at,
     timing_quality, source_quality, measurement_quality, semantic_payload_hash, supersedes_id,
     correction_kind, correction_reason, recorded_at, effective_at, created_at)
    VALUES (?, ?, 'settlement_result', 'settlement_result', 'rr-payload-v1', ?, ?, NULL, ?, ?,
            'observed_only', 'official_public', 'official_archive', ?, NULL, NULL, NULL, ?, ?, ?)
  `);
  const insertPayload = db.prepare(`
    INSERT OR IGNORE INTO typed_observation_payloads
    (observation_id, payload_type, payload_schema_version, payload_json, payload_hash, created_at)
    VALUES (?, 'settlement_result', 'rr-payload-v1', ?, ?, ?)
  `);
  for (const condition of parsed.conditions) {
    const code = VENUE_CODES[condition.venue];
    if (!code || condition.raceNo < 1 || condition.raceNo > 12) continue;
    const raceKey = `${condition.date}:${code}:R${condition.raceNo}`;
    result.parsedRaces += 1;
    result.firstRaceKey ??= raceKey;
    result.lastRaceKey = raceKey;
    const lines = payoutByRace.get(condition.raceId) ?? [];
    const byBet = new Map<SettlementBetType, RacePayout[]>();
    for (const line of lines) {
      if (!(BET_TYPES as readonly string[]).includes(line.betType)) continue;
      const bt = line.betType as SettlementBetType;
      const list = byBet.get(bt) ?? [];
      list.push(line);
      byBet.set(bt, list);
    }
    const payload = {
      canonicalRaceKey: raceKey, sourceKind: "official_archive" as const,
      parseStatus: "success" as const, candidateCount: byBet.size, diagnosticCodes: [] as string[],
    };
    const observationId = `${input.idPrefix}-obs-${raw.rawDocumentId}-${++observationSeq}`;
    const payloadHash = semanticPayloadHash("settlement_result", payload);
    insertObs.run(observationId, raceKey, parseRunId, raw.rawDocumentId, now, now, payloadHash, now, now, now);
    insertPayload.run(observationId, JSON.stringify(payload), payloadHash, now);
    for (const [betType, betLines] of byBet) {
      const bucket = classifyRaceLines(betType, betLines);
      const status = resolveStatus(bucket);
      if (!status) continue;
      const resultKind = bucket.payouts.some((line) => line.lineKind === "special_payout") ? "special_payout" : "normal";
      try {
        const appended = settlement.appendCandidate({
          canonicalRaceKey: raceKey, betType, settlementStatus: status, resultKind,
          revisionKind: "initial", resolutionStatus: "resolved", sourceKind: "official_archive",
          sourceSchemaVersion: family, observationId, parseRunId, rawDocumentId: raw.rawDocumentId,
          observedAt: now, payouts: bucket.payouts, refunds: bucket.refunds, emitEvidencePins: false,
        });
        if (!appended.inserted) continue;
        result.candidates += 1;
        result.payoutLines += bucket.payouts.length;
        result.refundLines += bucket.refunds.length;
      } catch {
        // 異常lineはcandidate生成を拒否しskip（raw/parse/observationは保持）。
      }
    }
  }
  return result;
}

export type BackfillRunSummary = {
  executorVersion: string;
  externalRequests: 0;
  requestedFiles: number;
  processedFiles: number;
  skippedCompleted: number;
  failedFiles: number;
  candidates: number;
  payoutLines: number;
  refundLines: number;
  parsedRaces: number;
  checkpointsRecorded: number;
  fileResults: ArchiveFileResult[];
};

// checkpoint駆動でarchive fileを順に処理する。maxFilesで小規模検証（sample）に制限できる。
// 実8,164 backfillは別承認・quota引き上げ・十分なdisk確認の後にmaxFiles無しで実行する想定。
export async function runBackfill(input: {
  db: DatabaseSync;
  rawStore: RawStore;
  archiveFiles: string[];
  now: string;
  idPrefix?: string;
  maxFiles?: number;
  transactionBatchSize?: number;
}): Promise<BackfillRunSummary> {
  const idPrefix = input.idPrefix ?? "n1bf";
  const checkpoints = new BackfillCheckpointRepository(input.db);
  const replay = new ResearchReplayRepository(input.db, input.rawStore, undefined, () => input.now);
  const settlement = new SettlementRepository(input.db);
  const files = input.maxFiles ? input.archiveFiles.slice(0, input.maxFiles) : input.archiveFiles;
  const summary: BackfillRunSummary = {
    executorVersion: N1_BACKFILL_EXECUTOR_VERSION, externalRequests: 0,
    requestedFiles: files.length, processedFiles: 0, skippedCompleted: 0, failedFiles: 0,
    candidates: 0, payoutLines: 0, refundLines: 0, parsedRaces: 0, checkpointsRecorded: 0, fileResults: [],
  };
  for (const filePath of files) {
    const file = basename(filePath);
    if (checkpoints.isCompleted(file)) { summary.skippedCompleted += 1; continue; }
    const previous = checkpoints.latest(file);
    const retryCount = previous ? previous.retryCount + 1 : 0;
    const sha256 = createHash("sha256").update(readFileSync(filePath)).digest("hex");
    try {
      const fileResult = await ingestArchiveFile({ filePath, replay, settlement, db: input.db, now: input.now, idPrefix });
      checkpoints.record({
        archiveFile: file, sourceArchiveSha256: sha256, parserVersion: N1_SETTLEMENT_PARSER_VERSION,
        sourceSchemaFamily: "official_archive", firstRaceKey: fileResult.firstRaceKey, lastRaceKey: fileResult.lastRaceKey,
        expectedRaceCount: fileResult.parsedRaces, parsedRaceCount: fileResult.parsedRaces,
        candidateCount: fileResult.candidates, payoutLineCount: fileResult.payoutLines,
        refundLineCount: fileResult.refundLines, transactionBatchSize: input.transactionBatchSize ?? 1000,
        resumeToken: null, state: "completed", retryCount, failureReason: null,
        createdAt: input.now, completedAt: input.now,
      });
      summary.processedFiles += 1;
      summary.checkpointsRecorded += 1;
      summary.candidates += fileResult.candidates;
      summary.payoutLines += fileResult.payoutLines;
      summary.refundLines += fileResult.refundLines;
      summary.parsedRaces += fileResult.parsedRaces;
      summary.fileResults.push(fileResult);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 200) : "unknown";
      checkpoints.record({
        archiveFile: file, sourceArchiveSha256: sha256, parserVersion: N1_SETTLEMENT_PARSER_VERSION,
        sourceSchemaFamily: "official_archive", firstRaceKey: null, lastRaceKey: null,
        expectedRaceCount: 0, parsedRaceCount: 0, candidateCount: 0, payoutLineCount: 0, refundLineCount: 0,
        transactionBatchSize: input.transactionBatchSize ?? 1000, resumeToken: null, state: "failed",
        retryCount, failureReason: reason, createdAt: input.now, completedAt: null,
      });
      summary.failedFiles += 1;
      summary.checkpointsRecorded += 1;
      summary.fileResults.push({
        archiveFile: file, state: "failed", parsedRaces: 0, candidates: 0, payoutLines: 0,
        refundLines: 0, firstRaceKey: null, lastRaceKey: null, failureReason: reason,
      });
    }
  }
  return summary;
}
