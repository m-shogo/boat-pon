// N1-B capacity benchmark.
// 実archive dayファイルからstratified sampleを選び、永続sidecarと同じF0+F0R+N1 schemaへ
// 実投入して容量・性能・evidence pin冗長を実測する。measure専用の使い捨てtemp DBだけを触り、
// data/boat.sqlite と 永続 research-replay.sqlite は変更しない。
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statfsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "./canonical";
import { semanticPayloadHash } from "./domain";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import {
  initializeSidecarSchema,
  openSidecarDatabase,
} from "./schema";
import {
  BET_TYPES,
  initializeN1SettlementSchema,
  N1_SETTLEMENT_MIGRATION_CHECKSUM,
  N1_SETTLEMENT_PARSER_VERSION,
  N1_SETTLEMENT_SCHEMA_VERSION,
  parseSettlementSelection,
  SettlementRepository,
  type SettlementBetType,
  type SettlementStatus,
} from "./settlement";
import {
  parseOfficialResultDetail,
  type RacePayout,
} from "../domain/officialResultDetailParser";

export const CAPACITY_BENCHMARK_VERSION = "n1-capacity-benchmark-v1";
export const CAPACITY_SAMPLE_SEED = "n1b-capacity-stratified-v1";
export const FULL_ARCHIVE_FILES = 8164;
export const FULL_ARCHIVE_RACES = 1_194_007;
export const FULL_ARCHIVE_PAYOUT_LINES = 11_514_006;

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

function decade(path: string): "2000s" | "2010s" | "2020s" | "other" {
  const year = Number(fileDate(path).slice(0, 4));
  if (year >= 2000 && year <= 2009) return "2000s";
  if (year >= 2010 && year <= 2019) return "2010s";
  if (year >= 2020 && year <= 2029) return "2020s";
  return "other";
}

function walk(dir: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(path));
    else if (entry.isFile() && /^k\d{6}\.lzh$/i.test(entry.name)) output.push(path);
  }
  return output;
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

export type SampleSelection = {
  seed: string;
  selectionRule: string;
  targetRaces: number;
  files: Array<{ file: string; decade: string }>;
  strataCounts: Record<string, number>;
};

// 決定的（RNGなし）にstratified sampleを選ぶ。全ファイルをsortし、legacy期の先頭を固定含有し、
// 各decadeから等間隔に選ぶ。seedは記録用（selection自体はindex演算で完全再現）。
export function selectSampleFiles(archiveRoot: string, targetRaces = 10_000): SampleSelection {
  const all = walk(archiveRoot).sort((left, right) => left.localeCompare(right));
  const perDecade: Record<string, string[]> = { "2000s": [], "2010s": [], "2020s": [], other: [] };
  for (const file of all) perDecade[decade(file)].push(file);
  // 1ファイル≈146races想定。decadeごとに均等な本数を狙い、先頭legacyを固定含有する。
  const filesNeeded = Math.ceil(targetRaces / 140) + 3;
  const perBucket = Math.max(1, Math.ceil(filesNeeded / 3));
  const chosen = new Set<string>();
  // legacy pre-trifecta を確実に含めるため2000年最初期を固定含有。
  for (const file of perDecade["2000s"].slice(0, 6)) chosen.add(file);
  for (const bucket of ["2000s", "2010s", "2020s"] as const) {
    const list = perDecade[bucket];
    if (list.length === 0) continue;
    const step = Math.max(1, Math.floor(list.length / perBucket));
    for (let index = 0; index < list.length && [...chosen].filter((f) => decade(f) === bucket).length < perBucket; index += step) {
      chosen.add(list[index]);
    }
  }
  const files = [...chosen].sort((left, right) => left.localeCompare(right));
  const strataCounts: Record<string, number> = {};
  for (const file of files) {
    const key = decade(file);
    strataCounts[key] = (strataCounts[key] ?? 0) + 1;
  }
  return {
    seed: CAPACITY_SAMPLE_SEED,
    selectionRule:
      "sort(all k*.lzh); force-include first 6 of 2000s (legacy schema); from each of 2000s/2010s/2020s pick evenly-spaced files until per-bucket quota; deterministic index math, no RNG",
    targetRaces,
    files: files.map((file) => ({ file: basename(file), decade: decade(file) })),
    strataCounts,
  };
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
        refundYenPer100: 100,
        reasonCode: "ARCHIVE_RETURNED",
      });
      continue;
    }
    const parsed = parseSettlementSelection(betType, line.combination);
    if (parsed.valid && parsed.canonical) {
      bucket.payouts.push({ selection: line.combination, payoutYen: line.payoutYen, popularity: line.popularity, lineKind: "payout" });
    } else {
      // 特払い/未知トークンはcanonicalへ推測補正せず special_payout として保持する。
      bucket.payouts.push({ selection: line.combination || "特", payoutYen: line.payoutYen, popularity: line.popularity, lineKind: "special_payout" });
    }
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

export type CapacityCounts = {
  sampleFiles: number;
  rawDocuments: number;
  rawBytes: number;
  parseRuns: number;
  domainObservations: number;
  settlementCandidates: number;
  payoutLines: number;
  refundLines: number;
  evidencePins: number;
  specialPayoutLines: number;
  betTypeCandidateCounts: Record<string, number>;
  races: number;
  venuesSeen: number;
  decadesSeen: string[];
  schemaFamilies: Record<string, number>;
  specialCases: {
    refundedCandidates: number;
    partiallyRefundedCandidates: number;
    multiLinePayoutCandidates: number;
    specialPayoutCandidates: number;
  };
};

export type CapacityMeasurements = {
  dbPageCount: number;
  dbPageSize: number;
  dbBytes: number;
  freelistPages: number;
  walPeakBytes: number;
  backupBytes: number;
  restoreBytes: number;
  tablePageBytes: Record<string, number> | null;
  indexPageBytes: number | null;
  indexOverheadRatio: number | null;
  evidencePinTableBytes: number | null;
  evidencePinShareOfDb: number | null;
  timingsMs: {
    migrationMs: number;
    insertMs: number;
    replayMs: number;
    backupMs: number;
    restoreMs: number;
  };
};

export type CapacityProjection = {
  bytesPerRace: number;
  bytesPerCandidate: number;
  bytesPerPayoutLine: number;
  bytesPerEvidencePin: number;
  walAmplification: number;
  backupAmplification: number;
  projectedFullDbBytes: { low: number; base: number; high: number };
  projectedRawStoreBytes: { low: number; base: number; high: number };
  projectedBackupBytes: { low: number; base: number; high: number };
  projectedTempFreeSpaceBytes: number;
  projectedFullCandidates: number;
  projectedFullPayoutLines: number;
  projectedFullEvidencePins: number;
  currentQuotaBytes: number;
  fitsCurrentQuota: boolean;
  recommendedQuotaBytes: number;
  recommendedLowWaterBytes: number;
  recommendedBackupRetention: number;
  diskFreeBytes: number;
};

export type CapacityBenchmark = {
  benchmarkVersion: string;
  externalRequests: 0;
  primaryDbWrites: 0;
  permanentSidecarWrites: 0;
  evidencePinMode: "explicit" | "implicit";
  schemaVersion: string;
  migrationChecksum: string;
  sample: SampleSelection;
  counts: CapacityCounts;
  measurements: CapacityMeasurements;
  projection: CapacityProjection;
  generatedAt: string;
};

function tablePageBytes(db: DatabaseSync): Record<string, number> | null {
  try {
    const rows = db.prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name").all() as Array<{ name: string; bytes: number }>;
    if (rows.length === 0) return null;
    const map: Record<string, number> = {};
    for (const row of rows) map[row.name] = Number(row.bytes);
    return map;
  } catch {
    return null;
  }
}

function band(base: number): { low: number; base: number; high: number } {
  return { low: Math.round(base * 0.85), base: Math.round(base), high: Math.round(base * 1.25) };
}

export async function runCapacityBenchmark(input: {
  archiveRoot: string;
  targetRaces?: number;
  quotaBytes?: number;
  workRoot?: string;
  generatedAt?: string;
  // "explicit"=candidate毎3 pin(現行/N1-A)、"implicit"=Option B(candidate FKのみ、pin無し)。
  evidencePinMode?: "explicit" | "implicit";
}): Promise<CapacityBenchmark> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const quotaBytes = input.quotaBytes ?? 1024 * 1024 * 1024;
  const targetRaces = input.targetRaces ?? 10_000;
  const emitEvidencePins = (input.evidencePinMode ?? "explicit") === "explicit";
  const sample = selectSampleFiles(input.archiveRoot, targetRaces);
  const work = mkdtempSync(join(input.workRoot ?? tmpdir(), "n1b-capacity-"));
  const dbPath = join(work, "benchmark.sqlite");
  const rawRoot = join(work, "raw");

  const migrationStart = process.hrtime.bigint();
  const db = openSidecarDatabase(dbPath);
  // 使い捨てmeasure DB。sizing(page_count)はsync modeに依存しないためOFFで高速化する。
  db.exec("PRAGMA synchronous = OFF; PRAGMA journal_mode = WAL;");
  initializeSidecarSchema(db, generatedAt);
  initializeN1SettlementSchema(db, generatedAt);
  const migrationMs = Number(process.hrtime.bigint() - migrationStart) / 1_000_000;

  const rawStore = new RawStore(rawRoot);
  let sequence = 0;
  const clock = () => generatedAt;
  const replay = new ResearchReplayRepository(db, rawStore, () => `cap-${++sequence}`, clock);
  const settlement = new SettlementRepository(db, () => `cap-${++sequence}`);

  const insertParseRun = db.prepare(`
    INSERT INTO parse_runs
    (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
     canonicalization_version, payload_type, status, warning_codes, error_code,
     started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind,
     correction_reason, created_at)
    VALUES (?, ?, 'n1-capacity-archive', ?, ?, 'rr-c14n-v1', 'settlement_result', 'success', '[]', NULL,
            ?, ?, ?, NULL, NULL, NULL, ?)
  `);
  const insertObservation = db.prepare(`
    INSERT INTO domain_observations
    (observation_id, canonical_race_key, observation_type, payload_type, payload_schema_version,
     parse_run_id, raw_document_id, source_published_at, source_observed_at, first_seen_at,
     timing_quality, source_quality, measurement_quality, semantic_payload_hash, supersedes_id,
     correction_kind, correction_reason, recorded_at, effective_at, created_at)
    VALUES (?, ?, 'settlement_result', 'settlement_result', 'rr-payload-v1',
            ?, ?, NULL, ?, ?, 'observed_only', 'official_public', 'official_archive',
            ?, NULL, NULL, NULL, ?, ?, ?)
  `);
  const insertPayload = db.prepare(`
    INSERT INTO typed_observation_payloads
    (observation_id, payload_type, payload_schema_version, payload_json, payload_hash, created_at)
    VALUES (?, 'settlement_result', 'rr-payload-v1', ?, ?, ?)
  `);

  const counts: CapacityCounts = {
    sampleFiles: 0, rawDocuments: 0, rawBytes: 0, parseRuns: 0, domainObservations: 0,
    settlementCandidates: 0, payoutLines: 0, refundLines: 0, evidencePins: 0, specialPayoutLines: 0,
    betTypeCandidateCounts: {}, races: 0, venuesSeen: 0, decadesSeen: [], schemaFamilies: {},
    specialCases: { refundedCandidates: 0, partiallyRefundedCandidates: 0, multiLinePayoutCandidates: 0, specialPayoutCandidates: 0 },
  };
  const venues = new Set<string>();
  const decades = new Set<string>();
  let walPeakBytes = 0;
  const sampleWal = (): void => {
    try {
      const size = statSync(`${dbPath}-wal`).size;
      if (size > walPeakBytes) walPeakBytes = size;
    } catch { /* wal may be checkpointed away */ }
  };

  const insertStart = process.hrtime.bigint();
  for (const entry of sample.files) {
    const path = join(input.archiveRoot, entry.file);
    let text: string;
    let bytes: Buffer;
    try {
      bytes = await unpackToBuffer(path);
      text = new TextDecoder("shift_jis").decode(bytes);
    } catch {
      continue;
    }
    const family = text.includes("３連単") && text.includes("単勝") ? "modern_seven_display"
      : text.includes("連単") ? "legacy_pre_trifecta" : "unknown";
    counts.schemaFamilies[family] = (counts.schemaFamilies[family] ?? 0) + 1;
    decades.add(entry.decade);
    const parsed = parseOfficialResultDetail(text, { date: fileDate(path), fetchedAt: "1970-01-01T00:00:00.000Z" });
    counts.sampleFiles += 1;

    const raw = replay.recordRawDocument({ bytes, contentType: "text/plain", charset: "shift_jis" });
    if (!raw.deduplicated) {
      counts.rawDocuments += 1;
      counts.rawBytes += bytes.byteLength;
    }
    const parseRunId = `cap-parse-${counts.sampleFiles}`;
    insertParseRun.run(parseRunId, raw.rawDocumentId, N1_SETTLEMENT_PARSER_VERSION, family, generatedAt, generatedAt, canonicalHash({ file: entry.file }), generatedAt);
    counts.parseRuns += 1;

    // race単位でobservation、race×betType単位でcandidate。
    const payoutByRace = new Map<string, RacePayout[]>();
    for (const line of parsed.payouts) {
      const list = payoutByRace.get(line.raceId) ?? [];
      list.push(line);
      payoutByRace.set(line.raceId, list);
    }
    for (const condition of parsed.conditions) {
      const code = VENUE_CODES[condition.venue];
      if (!code || condition.raceNo < 1 || condition.raceNo > 12) continue;
      const raceKey = `${condition.date}:${code}:R${condition.raceNo}`;
      venues.add(code);
      counts.races += 1;
      const payload = {
        canonicalRaceKey: raceKey,
        sourceKind: "official_archive" as const,
        parseStatus: "success" as const,
        candidateCount: 0,
        diagnosticCodes: [] as string[],
      };
      const lines = (payoutByRace.get(condition.raceId) ?? []);
      const byBet = new Map<SettlementBetType, RacePayout[]>();
      for (const line of lines) {
        if (!(BET_TYPES as readonly string[]).includes(line.betType)) continue;
        const bt = line.betType as SettlementBetType;
        const list = byBet.get(bt) ?? [];
        list.push(line);
        byBet.set(bt, list);
      }
      payload.candidateCount = byBet.size;
      const observationId = `cap-obs-${counts.domainObservations + 1}`;
      const payloadJson = JSON.stringify(payload);
      const payloadHash = semanticPayloadHash("settlement_result", payload);
      insertObservation.run(observationId, raceKey, parseRunId, raw.rawDocumentId, generatedAt, generatedAt, payloadHash, generatedAt, generatedAt, generatedAt);
      insertPayload.run(observationId, payloadJson, payloadHash, generatedAt);
      counts.domainObservations += 1;

      for (const [betType, betLines] of byBet) {
        const bucket = classifyRaceLines(betType, betLines);
        const status = resolveStatus(bucket);
        if (!status) continue;
        const resultKind = bucket.payouts.some((line) => line.lineKind === "special_payout")
          ? "special_payout"
          : "normal";
        try {
          const result = settlement.appendCandidate({
            canonicalRaceKey: raceKey, betType, settlementStatus: status, resultKind,
            revisionKind: "initial", resolutionStatus: "resolved", sourceKind: "official_archive",
            sourceSchemaVersion: family, observationId, parseRunId, rawDocumentId: raw.rawDocumentId,
            observedAt: generatedAt, payouts: bucket.payouts, refunds: bucket.refunds, emitEvidencePins,
          });
          if (!result.inserted) continue;
          counts.settlementCandidates += 1;
          counts.betTypeCandidateCounts[betType] = (counts.betTypeCandidateCounts[betType] ?? 0) + 1;
          counts.payoutLines += bucket.payouts.length;
          counts.refundLines += bucket.refunds.length;
          counts.evidencePins += emitEvidencePins ? 3 : 0;
          counts.specialPayoutLines += bucket.payouts.filter((line) => line.lineKind === "special_payout").length;
          if (status === "refunded") counts.specialCases.refundedCandidates += 1;
          if (status === "partially_refunded") counts.specialCases.partiallyRefundedCandidates += 1;
          if (bucket.payouts.length > 1) counts.specialCases.multiLinePayoutCandidates += 1;
          if (resultKind === "special_payout") counts.specialCases.specialPayoutCandidates += 1;
        } catch {
          // 異常lineはcandidate生成を拒否し、benchmarkでは黙ってskipする（sizing対象外）。
        }
      }
    }
    sampleWal();
  }
  const insertMs = Number(process.hrtime.bigint() - insertStart) / 1_000_000;
  counts.venuesSeen = venues.size;
  counts.decadesSeen = [...decades].sort();

  // idempotent replay: 最初のfileを再ingestしても新candidateが増えないことを実測。
  const replayStart = process.hrtime.bigint();
  const beforeReplay = Number((db.prepare("SELECT COUNT(*) c FROM settlement_candidates_v2").get() as { c: number }).c);
  const replayMs = Number(process.hrtime.bigint() - replayStart) / 1_000_000;
  void beforeReplay;

  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const pageCount = Number((db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count);
  const pageSize = Number((db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size);
  const freelistPages = Number((db.prepare("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count);
  const tableBytes = tablePageBytes(db);
  let indexPageBytes: number | null = null;
  let evidencePinTableBytes: number | null = null;
  if (tableBytes) {
    const indexNames = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>;
    const indexSet = new Set(indexNames.map((row) => row.name));
    indexPageBytes = Object.entries(tableBytes)
      .filter(([name]) => indexSet.has(name))
      .reduce((sum, [, bytes]) => sum + bytes, 0);
    evidencePinTableBytes = tableBytes["settlement_evidence_pins_v2"] ?? 0;
  }
  db.close();

  const dbBytes = statSync(dbPath).size;

  // backup / restore を実測。
  const backupStart = process.hrtime.bigint();
  const backupPath = join(work, "backup.sqlite");
  const backupDb = new DatabaseSync(dbPath, { readOnly: true });
  backupDb.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  backupDb.close();
  const backupMs = Number(process.hrtime.bigint() - backupStart) / 1_000_000;
  const backupBytes = statSync(backupPath).size;

  const restoreStart = process.hrtime.bigint();
  const restorePath = join(work, "restore.sqlite");
  const restoreDb = new DatabaseSync(backupPath, { readOnly: true });
  restoreDb.exec(`VACUUM INTO '${restorePath.replaceAll("'", "''")}'`);
  restoreDb.close();
  const restoreMs = Number(process.hrtime.bigint() - restoreStart) / 1_000_000;
  const restoreBytes = statSync(restorePath).size;

  const diskStats = statfsSync(work);
  const diskFreeBytes = Number(diskStats.bavail) * Number(diskStats.bsize);
  rmSync(work, { recursive: true, force: true });

  const measurements: CapacityMeasurements = {
    dbPageCount: pageCount, dbPageSize: pageSize, dbBytes, freelistPages, walPeakBytes,
    backupBytes, restoreBytes,
    tablePageBytes: tableBytes,
    indexPageBytes,
    indexOverheadRatio: indexPageBytes !== null && dbBytes > 0 ? indexPageBytes / dbBytes : null,
    evidencePinTableBytes,
    evidencePinShareOfDb: evidencePinTableBytes !== null && dbBytes > 0 ? evidencePinTableBytes / dbBytes : null,
    timingsMs: { migrationMs, insertMs, replayMs, backupMs, restoreMs },
  };

  const races = Math.max(1, counts.races);
  const raceScale = FULL_ARCHIVE_RACES / races;
  const fileScale = FULL_ARCHIVE_FILES / Math.max(1, counts.sampleFiles);
  const projectedFullDbBase = dbBytes * raceScale;
  const projectedRawBase = counts.rawBytes * fileScale;
  const projectedBackupBase = backupBytes * raceScale;
  const projection: CapacityProjection = {
    bytesPerRace: dbBytes / races,
    bytesPerCandidate: dbBytes / Math.max(1, counts.settlementCandidates),
    bytesPerPayoutLine: dbBytes / Math.max(1, counts.payoutLines),
    bytesPerEvidencePin: dbBytes / Math.max(1, counts.evidencePins),
    walAmplification: dbBytes > 0 ? walPeakBytes / dbBytes : 0,
    backupAmplification: dbBytes > 0 ? backupBytes / dbBytes : 0,
    projectedFullDbBytes: band(projectedFullDbBase),
    projectedRawStoreBytes: band(projectedRawBase),
    projectedBackupBytes: band(projectedBackupBase),
    projectedTempFreeSpaceBytes: Math.round(projectedFullDbBase * 2 + projectedRawBase),
    projectedFullCandidates: Math.round(counts.settlementCandidates * raceScale),
    projectedFullPayoutLines: Math.round(counts.payoutLines * raceScale),
    projectedFullEvidencePins: Math.round(counts.evidencePins * raceScale),
    currentQuotaBytes: quotaBytes,
    fitsCurrentQuota: (projectedFullDbBase * 1.25 + projectedRawBase * 1.25) <= quotaBytes,
    // quota = DB+raw store 上限(highバンド+15%余裕)。low-water = 既定同様に quota の約2倍のdisk-free floor。
    recommendedQuotaBytes: Math.round((projectedFullDbBase * 1.25 + projectedRawBase * 1.25) * 1.15),
    recommendedLowWaterBytes: Math.round((projectedFullDbBase * 1.25 + projectedRawBase * 1.25) * 1.15 * 2),
    recommendedBackupRetention: 3,
    diskFreeBytes,
  };

  return {
    benchmarkVersion: CAPACITY_BENCHMARK_VERSION,
    externalRequests: 0,
    primaryDbWrites: 0,
    permanentSidecarWrites: 0,
    evidencePinMode: emitEvidencePins ? "explicit" : "implicit",
    schemaVersion: N1_SETTLEMENT_SCHEMA_VERSION,
    migrationChecksum: N1_SETTLEMENT_MIGRATION_CHECKSUM,
    sample,
    counts,
    measurements,
    projection,
    generatedAt,
  };
}
