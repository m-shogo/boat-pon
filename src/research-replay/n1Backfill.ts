// N1-C historical backfill executor（設計 docs/n1-settlement-backfill-design.md）。
// archive file単位のchunkでcandidateを永続sidecarへ投入し、event-sourced checkpointで
// 冪等resumeする。本モジュールは実装＋temp/restore検証用であり、実8,164 backfillは
// 別の明示承認まで起動しない。candidateはOption B（explicit pin無し、candidate FKが暗黙GC pin）。
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, statfsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "./canonical";
import { semanticPayloadHash } from "./domain";
import { canonicalRaceKey } from "./identity";
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

export const VENUE_CODES: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05", 浜名湖: "06",
  蒲郡: "07", 常滑: "08", 津: "09", 三国: "10", びわこ: "11", 住之江: "12",
  尼崎: "13", 鳴門: "14", 丸亀: "15", 児島: "16", 宮島: "17", 徳山: "18",
  下関: "19", 若松: "20", 芦屋: "21", 福岡: "22", 唐津: "23", 大村: "24",
};

export function backfillVenueCode(venue: string): string {
  const code = VENUE_CODES[venue];
  if (!code) throw new Error(`N1_BACKFILL_VENUE_INVALID:${venue}`);
  return code;
}

export function canonicalBackfillRaceKey(raceDateJst: string, venueCode: string, raceNo: number): string {
  return canonicalRaceKey(raceDateJst, venueCode, raceNo);
}

export function fileDate(path: string): string {
  const match = basename(path).match(/k(\d{2})(\d{2})(\d{2})\.lzh$/i);
  if (!match) return "1970-01-01";
  const year = Number(match[1]) >= 70 ? `19${match[1]}` : `20${match[1]}`;
  const date = `${year}-${match[2]}-${match[3]}`;
  canonicalBackfillRaceKey(date, "01", 1);
  return date;
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

export function schemaFamily(text: string): string {
  return text.includes("３連単") && text.includes("単勝") ? "modern_seven_display"
    : text.includes("連単") ? "legacy_pre_trifecta" : "unknown";
}

export type LineBucket = {
  payouts: Array<{ selection: string; payoutYen: number; popularity: number | null; lineKind: "payout" | "special_payout" }>;
  refunds: Array<{ selection: string | null; scope: "selection" | "bet_type" | "race"; refundYenPer100: number | null; reasonCode: string }>;
};

export function classifyRaceLines(betType: SettlementBetType, lines: RacePayout[]): LineBucket {
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

export function resolveStatus(bucket: LineBucket): SettlementStatus | null {
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
  skippedCandidates: number;
  firstRaceKey: string | null;
  lastRaceKey: string | null;
  failureReason: string | null;
};

type ParsedArchive = {
  file: string;
  bytes: Buffer;
  family: string;
  parsed: ReturnType<typeof parseOfficialResultDetail>;
  sha256: string;
};

async function parseArchive(filePath: string): Promise<ParsedArchive> {
  const bytes = await unpackToBuffer(filePath);
  const text = new TextDecoder("shift_jis").decode(bytes);
  return {
    file: basename(filePath),
    bytes,
    family: schemaFamily(text),
    parsed: parseOfficialResultDetail(text, { date: fileDate(filePath), fetchedAt: "1970-01-01T00:00:00.000Z" }),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function requireBackfillParseRunContract(input: {
  db: DatabaseSync;
  parseRunId: string;
  rawDocumentId: string;
  sourceSchemaVersion: string;
  semanticPayloadHash: string;
}): void {
  const row = input.db.prepare(`
    SELECT raw_document_id AS rawDocumentId, parser_name AS parserName, parser_version AS parserVersion,
           source_schema_version AS sourceSchemaVersion, canonicalization_version AS canonicalizationVersion,
           payload_type AS payloadType, status, warning_codes AS warningCodes, error_code AS errorCode,
           semantic_payload_hash AS semanticPayloadHash, supersedes_id AS supersedesId,
           correction_kind AS correctionKind, correction_reason AS correctionReason
    FROM parse_runs WHERE parse_run_id=?
  `).get(input.parseRunId) as {
    rawDocumentId: string;
    parserName: string;
    parserVersion: string;
    sourceSchemaVersion: string;
    canonicalizationVersion: string;
    payloadType: string;
    status: string;
    warningCodes: string;
    errorCode: string | null;
    semanticPayloadHash: string;
    supersedesId: string | null;
    correctionKind: string | null;
    correctionReason: string | null;
  } | undefined;
  if (
    row === undefined ||
    row.rawDocumentId !== input.rawDocumentId ||
    row.parserName !== "n1-backfill-archive" ||
    row.parserVersion !== N1_SETTLEMENT_PARSER_VERSION ||
    row.sourceSchemaVersion !== input.sourceSchemaVersion ||
    row.canonicalizationVersion !== "rr-c14n-v1" ||
    row.payloadType !== "settlement_result" ||
    row.status !== "success" ||
    row.warningCodes !== "[]" ||
    row.errorCode !== null ||
    row.semanticPayloadHash !== input.semanticPayloadHash ||
    row.supersedesId !== null ||
    row.correctionKind !== null ||
    row.correctionReason !== null
  ) {
    throw new Error(`N1_BACKFILL_PARSE_RUN_CONFLICT:${input.parseRunId}`);
  }
}

export function requireBackfillObservationContract(input: {
  db: DatabaseSync;
  observationId: string;
  canonicalRaceKey: string;
  parseRunId: string;
  rawDocumentId: string;
  semanticPayloadHash: string;
  payloadJson: string;
}): void {
  const row = input.db.prepare(`
    SELECT o.canonical_race_key AS canonicalRaceKey, o.observation_type AS observationType,
           o.payload_type AS observationPayloadType, o.payload_schema_version AS observationPayloadSchemaVersion,
           o.parse_run_id AS parseRunId, o.raw_document_id AS rawDocumentId,
           o.source_published_at AS sourcePublishedAt, o.timing_quality AS timingQuality,
           o.source_quality AS sourceQuality, o.measurement_quality AS measurementQuality,
           o.semantic_payload_hash AS observationSemanticPayloadHash, o.supersedes_id AS supersedesId,
           o.correction_kind AS correctionKind, o.correction_reason AS correctionReason,
           p.payload_type AS storedPayloadType, p.payload_schema_version AS storedPayloadSchemaVersion,
           p.payload_json AS payloadJson, p.payload_hash AS payloadHash
    FROM domain_observations o
    LEFT JOIN typed_observation_payloads p ON p.observation_id=o.observation_id
    WHERE o.observation_id=?
  `).get(input.observationId) as {
    canonicalRaceKey: string;
    observationType: string;
    observationPayloadType: string;
    observationPayloadSchemaVersion: string;
    parseRunId: string;
    rawDocumentId: string;
    sourcePublishedAt: string | null;
    timingQuality: string;
    sourceQuality: string;
    measurementQuality: string;
    observationSemanticPayloadHash: string;
    supersedesId: string | null;
    correctionKind: string | null;
    correctionReason: string | null;
    storedPayloadType: string | null;
    storedPayloadSchemaVersion: string | null;
    payloadJson: string | null;
    payloadHash: string | null;
  } | undefined;
  if (
    row === undefined ||
    row.canonicalRaceKey !== input.canonicalRaceKey ||
    row.observationType !== "settlement_result" ||
    row.observationPayloadType !== "settlement_result" ||
    row.observationPayloadSchemaVersion !== "rr-payload-v1" ||
    row.parseRunId !== input.parseRunId ||
    row.rawDocumentId !== input.rawDocumentId ||
    row.sourcePublishedAt !== null ||
    row.timingQuality !== "observed_only" ||
    row.sourceQuality !== "official_public" ||
    row.measurementQuality !== "official_archive" ||
    row.observationSemanticPayloadHash !== input.semanticPayloadHash ||
    row.supersedesId !== null ||
    row.correctionKind !== null ||
    row.correctionReason !== null ||
    row.storedPayloadType !== "settlement_result" ||
    row.storedPayloadSchemaVersion !== "rr-payload-v1" ||
    row.payloadJson !== input.payloadJson ||
    row.payloadHash !== input.semanticPayloadHash
  ) {
    throw new Error(`N1_BACKFILL_OBSERVATION_CONFLICT:${input.observationId}`);
  }
}

function ingestParsedArchive(input: {
  archive: ParsedArchive;
  replay: ResearchReplayRepository;
  settlement: SettlementRepository;
  db: DatabaseSync;
  now: string;
  idPrefix: string;
}): ArchiveFileResult {
  const { archive, replay, settlement, db, now } = input;
  const { file, bytes, family, parsed } = archive;
  const result: ArchiveFileResult = {
    archiveFile: file, state: "completed", parsedRaces: 0, candidates: 0,
    payoutLines: 0, refundLines: 0, skippedCandidates: 0, firstRaceKey: null, lastRaceKey: null, failureReason: null,
  };
  const raw = replay.recordRawDocument({ bytes, contentType: "text/plain", charset: "shift_jis" });
  const parseRunId = `${input.idPrefix}-parse-${raw.rawDocumentId}`;
  const parseSemanticHash = canonicalHash({ file });
  db.prepare(`
    INSERT OR IGNORE INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind,
     correction_reason, created_at)
    VALUES (?, ?, 'n1-backfill-archive', ?, ?, 'rr-c14n-v1', 'settlement_result', 'success', '[]', NULL,
            ?, ?, ?, NULL, NULL, NULL, ?)
  `).run(parseRunId, raw.rawDocumentId, N1_SETTLEMENT_PARSER_VERSION, family, now, now, parseSemanticHash, now);
  requireBackfillParseRunContract({
    db,
    parseRunId,
    rawDocumentId: raw.rawDocumentId,
    sourceSchemaVersion: family,
    semanticPayloadHash: parseSemanticHash,
  });

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
    const code = backfillVenueCode(condition.venue);
    const raceKey = canonicalBackfillRaceKey(condition.date, code, condition.raceNo);
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
    const payloadJson = JSON.stringify(payload);
    insertObs.run(observationId, raceKey, parseRunId, raw.rawDocumentId, now, now, payloadHash, now, now, now);
    insertPayload.run(observationId, payloadJson, payloadHash, now);
    requireBackfillObservationContract({
      db,
      observationId,
      canonicalRaceKey: raceKey,
      parseRunId,
      rawDocumentId: raw.rawDocumentId,
      semanticPayloadHash: payloadHash,
      payloadJson,
    });
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
          observedAt: now, payouts: bucket.payouts, refunds: bucket.refunds,
          emitEvidencePins: false, withinTransaction: true,
        });
        if (!appended.inserted) continue;
        result.candidates += 1;
        result.payoutLines += bucket.payouts.length;
        result.refundLines += bucket.refunds.length;
      } catch {
        result.skippedCandidates += 1;
      }
    }
  }
  return result;
}

export type BackfillHealthCheck = {
  atFilesCompleted: number;
  dbBytes: number;
  walBytes: number;
  diskFreeBytes: number;
  projectedFullDbBytes: number;
};

export type BackfillStopReason =
  | "DISK_LOW"
  | "QUOTA_80PCT"
  | "PROJECTED_EXCEEDS_QUOTA"
  | "PRIMARY_DB_CHANGED"
  | "WAL_ABNORMAL"
  | null;

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
  skippedCandidates: number;
  parsedRaces: number;
  checkpointsRecorded: number;
  stopped: boolean;
  stopReason: BackfillStopReason;
  startCompletedTotal: number;
  endCompletedTotal: number;
  dbBytesStart: number | null;
  dbBytesEnd: number | null;
  walPeakBytes: number;
  healthChecks: BackfillHealthCheck[];
  fileResults: ArchiveFileResult[];
};

export function latestBackfillCheckpointForParser(input: {
  db: DatabaseSync;
  archiveFile: string;
  parserVersion?: string;
}): { state: string; retryCount: number } | null {
  const parserVersion = input.parserVersion ?? N1_SETTLEMENT_PARSER_VERSION;
  const row = input.db.prepare(`
    SELECT state, retry_count AS retryCount
    FROM n1_settlement_backfill_checkpoints
    WHERE archive_file=? AND parser_version=?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `).get(input.archiveFile, parserVersion) as { state: string; retryCount: number } | undefined;
  return row ?? null;
}

export function completedBackfillCountForParser(input: {
  db: DatabaseSync;
  parserVersion?: string;
}): number {
  const parserVersion = input.parserVersion ?? N1_SETTLEMENT_PARSER_VERSION;
  return Number((input.db.prepare(`
    SELECT COUNT(*) c FROM (
      SELECT archive_file, state,
             ROW_NUMBER() OVER (PARTITION BY archive_file ORDER BY created_at DESC, rowid DESC) rn
      FROM n1_settlement_backfill_checkpoints
      WHERE parser_version=?
    ) WHERE rn=1 AND state='completed'
  `).get(parserVersion) as { c: number }).c);
}

function requireOptionalBound(name: "MAX_FILES" | "LIMIT", value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`N1_BACKFILL_${name}_INVALID:${value}`);
  }
}

export async function runBackfill(input: {
  db: DatabaseSync;
  rawStore: RawStore;
  archiveFiles: string[];
  now: string;
  idPrefix?: string;
  maxFiles?: number;
  limit?: number;
  transactionBatchSize?: number;
  dbPath?: string;
  quotaBytes?: number;
  diskFloorBytes?: number;
  primaryPath?: string;
  primaryFingerprint?: { size: number; mtimeMs: number };
  primaryMonitor?: "strict" | "structural";
  primaryStructuralBaseline?: { schemaHash: string | null; appSettingsHash: string | null };
  primaryStructuralProbe?: () => { schemaHash: string | null; appSettingsHash: string | null };
  totalArchiveCount?: number;
  healthEvery?: number;
  onProgress?: (completedTotal: number, file: string) => void;
}): Promise<BackfillRunSummary> {
  requireOptionalBound("MAX_FILES", input.maxFiles);
  requireOptionalBound("LIMIT", input.limit);
  const primaryMonitor = input.primaryMonitor ?? "strict";
  const idPrefix = input.idPrefix ?? "n1bf";
  const checkpoints = new BackfillCheckpointRepository(input.db);
  const replay = new ResearchReplayRepository(input.db, input.rawStore, undefined, () => input.now);
  const settlement = new SettlementRepository(input.db);
  const files = input.maxFiles !== undefined ? input.archiveFiles.slice(0, input.maxFiles) : input.archiveFiles;
  const totalArchiveCount = input.totalArchiveCount ?? input.archiveFiles.length;
  const dbSize = (): number | null => input.dbPath ? statSync(input.dbPath).size : null;
  const walSize = (): number => { try { return input.dbPath ? statSync(`${input.dbPath}-wal`).size : 0; } catch { return 0; } };
  const diskFree = (): number => {
    const target = input.dbPath ? dirname(input.dbPath) : input.rawStore.root;
    const s = statfsSync(target);
    return Number(s.bavail) * Number(s.bsize);
  };
  const startCompletedTotal = completedBackfillCountForParser({ db: input.db });
  const summary: BackfillRunSummary = {
    executorVersion: N1_BACKFILL_EXECUTOR_VERSION, externalRequests: 0,
    requestedFiles: files.length, processedFiles: 0, skippedCompleted: 0, failedFiles: 0,
    candidates: 0, payoutLines: 0, refundLines: 0, skippedCandidates: 0, parsedRaces: 0, checkpointsRecorded: 0,
    stopped: false, stopReason: null, startCompletedTotal, endCompletedTotal: startCompletedTotal,
    dbBytesStart: dbSize(), dbBytesEnd: null, walPeakBytes: walSize(), healthChecks: [],
    fileResults: [],
  };
  const healthEvery = input.healthEvery ?? 50;

  const guard = (): BackfillStopReason => {
    if (input.diskFloorBytes && diskFree() < input.diskFloorBytes) return "DISK_LOW";
    const bytes = dbSize();
    if (input.quotaBytes && bytes !== null && bytes >= input.quotaBytes * 0.8) return "QUOTA_80PCT";
    const completed = summary.startCompletedTotal + summary.processedFiles;
    if (input.quotaBytes && bytes !== null && completed > 0) {
      const projected = (bytes / completed) * totalArchiveCount;
      if (projected > input.quotaBytes) return "PROJECTED_EXCEEDS_QUOTA";
    }
    if (input.primaryPath && primaryMonitor === "strict" && input.primaryFingerprint) {
      try {
        const s = statSync(input.primaryPath);
        if (s.size !== input.primaryFingerprint.size || Math.trunc(s.mtimeMs) !== Math.trunc(input.primaryFingerprint.mtimeMs)) {
          return "PRIMARY_DB_CHANGED";
        }
      } catch { return "PRIMARY_DB_CHANGED"; }
    }
    if (primaryMonitor === "structural" && input.primaryStructuralBaseline && input.primaryStructuralProbe) {
      try {
        const now = input.primaryStructuralProbe();
        if (now.schemaHash !== input.primaryStructuralBaseline.schemaHash
          || now.appSettingsHash !== input.primaryStructuralBaseline.appSettingsHash) {
          return "PRIMARY_DB_CHANGED";
        }
      } catch { return "PRIMARY_DB_CHANGED"; }
    }
    return null;
  };

  const recordFailed = (file: string, sha256: string, retryCount: number, reason: string): void => {
    checkpoints.record({
      archiveFile: file, sourceArchiveSha256: sha256, parserVersion: N1_SETTLEMENT_PARSER_VERSION,
      sourceSchemaFamily: "official_archive", firstRaceKey: null, lastRaceKey: null,
      expectedRaceCount: 0, parsedRaceCount: 0, candidateCount: 0, payoutLineCount: 0, refundLineCount: 0,
      transactionBatchSize: input.transactionBatchSize ?? 1000, resumeToken: null, state: "failed",
      retryCount, failureReason: reason.slice(0, 200), createdAt: input.now, completedAt: null,
    });
    summary.failedFiles += 1;
    summary.checkpointsRecorded += 1;
  };

  for (const filePath of files) {
    const file = basename(filePath);
    if (latestBackfillCheckpointForParser({ db: input.db, archiveFile: file })?.state === "completed") {
      summary.skippedCompleted += 1;
      continue;
    }
    if (input.limit !== undefined && summary.processedFiles >= input.limit) break;

    const stop = guard();
    if (stop) { summary.stopped = true; summary.stopReason = stop; break; }

    const previous = latestBackfillCheckpointForParser({ db: input.db, archiveFile: file });
    const retryCount = previous ? previous.retryCount + 1 : 0;

    let archive: ParsedArchive;
    try {
      archive = await parseArchive(filePath);
    } catch (error) {
      recordFailed(file, "0".repeat(64), retryCount, error instanceof Error ? error.message : "parse_failed");
      summary.fileResults.push({ archiveFile: file, state: "failed", parsedRaces: 0, candidates: 0, payoutLines: 0, refundLines: 0, skippedCandidates: 0, firstRaceKey: null, lastRaceKey: null, failureReason: "parse_failed" });
      continue;
    }

    input.db.exec("BEGIN IMMEDIATE");
    try {
      const fileResult = ingestParsedArchive({ archive, replay, settlement, db: input.db, now: input.now, idPrefix });
      checkpoints.record({
        archiveFile: file, sourceArchiveSha256: archive.sha256, parserVersion: N1_SETTLEMENT_PARSER_VERSION,
        sourceSchemaFamily: archive.family, firstRaceKey: fileResult.firstRaceKey, lastRaceKey: fileResult.lastRaceKey,
        expectedRaceCount: fileResult.parsedRaces, parsedRaceCount: fileResult.parsedRaces,
        candidateCount: fileResult.candidates, payoutLineCount: fileResult.payoutLines,
        refundLineCount: fileResult.refundLines, transactionBatchSize: input.transactionBatchSize ?? 1000,
        resumeToken: file, state: "completed", retryCount, failureReason: null,
        createdAt: input.now, completedAt: input.now,
      });
      input.db.exec("COMMIT");
      summary.processedFiles += 1;
      summary.checkpointsRecorded += 1;
      summary.candidates += fileResult.candidates;
      summary.payoutLines += fileResult.payoutLines;
      summary.refundLines += fileResult.refundLines;
      summary.skippedCandidates += fileResult.skippedCandidates;
      summary.parsedRaces += fileResult.parsedRaces;
      summary.fileResults.push(fileResult);
      input.onProgress?.(startCompletedTotal + summary.processedFiles, file);
    } catch (error) {
      try { input.db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      recordFailed(file, archive.sha256, retryCount, error instanceof Error ? error.message : "ingest_failed");
      summary.fileResults.push({ archiveFile: file, state: "failed", parsedRaces: 0, candidates: 0, payoutLines: 0, refundLines: 0, skippedCandidates: 0, firstRaceKey: null, lastRaceKey: null, failureReason: error instanceof Error ? error.message.slice(0, 200) : "ingest_failed" });
    }

    const wal = walSize();
    if (wal > summary.walPeakBytes) summary.walPeakBytes = wal;
    if (summary.processedFiles > 0 && summary.processedFiles % healthEvery === 0) {
      const bytes = dbSize();
      const completed = startCompletedTotal + summary.processedFiles;
      summary.healthChecks.push({
        atFilesCompleted: completed, dbBytes: bytes ?? 0, walBytes: wal, diskFreeBytes: diskFree(),
        projectedFullDbBytes: bytes !== null && completed > 0 ? Math.round((bytes / completed) * totalArchiveCount) : 0,
      });
    }
  }
  summary.dbBytesEnd = dbSize();
  summary.endCompletedTotal = completedBackfillCountForParser({ db: input.db });
  return summary;
}
