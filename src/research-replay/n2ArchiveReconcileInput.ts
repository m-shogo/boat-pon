import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { canonicalHash, canonicalUtcTimestamp, sha256Bytes } from "./canonical";
import { parseCanonicalRaceKey } from "./identity";
import { fileDate } from "./n1Backfill";
import { BET_TYPES } from "./settlement";

export const ARCHIVE_RECONCILE_SELECTION_VERSION = "n2-archive-reconcile-selection-v3";
export const ARCHIVE_RECONCILE_CHECKPOINT_VERSION = "n2-archive-reconcile-checkpoint-v6";
export const ARCHIVE_RECONCILE_CHECKPOINT_STATE_DIGEST_VERSION = "n2-archive-reconcile-checkpoint-state-digest-v1";
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MAX_RECONCILE_SAMPLES = 200;
const BET_TYPE_SET: ReadonlySet<string> = new Set(BET_TYPES);
const SETTLEMENT_STATUS_SET: ReadonlySet<string> = new Set([
  "pending", "settled", "refunded", "partially_refunded", "cancelled", "no_sale",
]);
const RESULT_KIND_SET: ReadonlySet<string> = new Set([
  "normal", "special_payout", "dead_heat", "source_defined", "unknown",
]);

export type ArchiveReconcileSelection = {
  asOf: string;
  cutoffDate: string;
  eligibleFiles: string[];
  selectedFiles: string[];
  inventoryDigest: string;
};

export type ArchiveReconcileCheckpointContract = {
  checkpointVersion: string;
  selectionVersion: string;
  asOf: string;
  inventoryDigest: string;
  selectedFileCount: number;
  selectedFileBasenames: string[];
  sourceSidecarSha256: string;
};

function assertCalendarDate(date: string, file: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`ARCHIVE_FILE_DATE_INVALID:${file}:${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`ARCHIVE_FILE_DATE_INVALID:${file}:${date}`);
  }
}

function archiveFilenameDate(file: string): string | null {
  const match = /^k(\d{2})(\d{2})(\d{2})\.lzh$/i.exec(file);
  if (!match) return null;
  const year = Number(match[1]) >= 70 ? `19${match[1]}` : `20${match[1]}`;
  return `${year}-${match[2]}-${match[3]}`;
}

function lastCompletedJstRaceDate(asOf: string): string {
  const jst = new Date(Date.parse(asOf) + JST_OFFSET_MS);
  const startOfCurrentJstDateUtc = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
  return new Date(startOfCurrentJstDateUtc - 1).toISOString().slice(0, 10);
}

export function buildArchiveReconcileSelection(input: {
  discoveredFiles: readonly string[];
  asOf: string | null;
  limit: number | null;
  readArchiveBytes?: (path: string) => Uint8Array;
}): ArchiveReconcileSelection {
  if (!input.asOf) throw new Error("ARCHIVE_RECONCILE_AS_OF_MISSING");
  if (input.limit !== null && (!Number.isSafeInteger(input.limit) || input.limit <= 0)) {
    throw new Error(`ARCHIVE_RECONCILE_LIMIT_INVALID:${String(input.limit)}`);
  }
  const asOf = canonicalUtcTimestamp(input.asOf);
  const cutoffDate = lastCompletedJstRaceDate(asOf);
  const dated = input.discoveredFiles.map((path) => {
    const file = basename(path);
    let date: string;
    try {
      date = fileDate(path);
    } catch (error) {
      const parsedFilenameDate = archiveFilenameDate(file);
      if (parsedFilenameDate !== null) {
        throw new Error(`ARCHIVE_FILE_DATE_INVALID:${file}:${parsedFilenameDate}`, { cause: error });
      }
      throw error;
    }
    assertCalendarDate(date, file);
    return { path, file, date };
  });
  const eligible = dated
    .filter((entry) => entry.date <= cutoffDate)
    .sort((left, right) => left.date.localeCompare(right.date)
      || left.file.localeCompare(right.file)
      || left.path.localeCompare(right.path));

  const seen = new Set<string>();
  for (const entry of eligible) {
    if (seen.has(entry.file)) throw new Error(`ARCHIVE_INVENTORY_BASENAME_DUPLICATE:${entry.file}`);
    seen.add(entry.file);
  }

  const selected = input.limit == null ? eligible : eligible.slice(0, input.limit);
  const selectedFiles = selected.map((entry) => entry.path);
  const readArchiveBytes = input.readArchiveBytes ?? readFileSync;
  const inventoryDigest = canonicalHash(selected.map((entry) => ({
    file: entry.file,
    compressedSha256: sha256Bytes(readArchiveBytes(entry.path)),
  })));
  return {
    asOf,
    cutoffDate,
    eligibleFiles: eligible.map((entry) => entry.path),
    selectedFiles,
    inventoryDigest,
  };
}

export function archiveReconcileCheckpointContract(
  selection: ArchiveReconcileSelection,
  sourceSidecarSha256: string,
): ArchiveReconcileCheckpointContract {
  if (!/^[0-9a-f]{64}$/.test(sourceSidecarSha256)) {
    throw new Error("ARCHIVE_RECONCILE_SIDECAR_SHA_INVALID");
  }
  return {
    checkpointVersion: ARCHIVE_RECONCILE_CHECKPOINT_VERSION,
    selectionVersion: ARCHIVE_RECONCILE_SELECTION_VERSION,
    asOf: selection.asOf,
    inventoryDigest: selection.inventoryDigest,
    selectedFileCount: selection.selectedFiles.length,
    selectedFileBasenames: selection.selectedFiles.map((path) => basename(path)),
    sourceSidecarSha256,
  };
}

export function assertArchiveReconcileCheckpointContract(
  actual: unknown,
  expected: ArchiveReconcileCheckpointContract,
): void {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_CONTRACT_MISSING");
  }
  const record = actual as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    if (Array.isArray(value)) {
      if (!Array.isArray(record[key]) || canonicalHash(record[key]) !== canonicalHash(value)) {
        throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_CONTRACT_MISMATCH:${key}`);
      }
      continue;
    }
    if (record[key] !== value) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_CONTRACT_MISMATCH:${key}`);
    }
  }
}

export function buildArchiveReconcileCheckpointStateDigest(
  checkpointContract: ArchiveReconcileCheckpointContract,
  state: unknown,
): string {
  return canonicalHash({
    digestVersion: ARCHIVE_RECONCILE_CHECKPOINT_STATE_DIGEST_VERSION,
    checkpointContract,
    state,
  });
}

function assertArchiveReconcileProcessedFiles(
  checkpointContract: ArchiveReconcileCheckpointContract,
  state: unknown,
): void {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_STATE_INVALID");
  }
  const processedFiles = (state as Record<string, unknown>).processedFiles;
  if (!Array.isArray(processedFiles)) {
    throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_PROCESSED_FILES_INVALID");
  }
  const allowed = new Set(checkpointContract.selectedFileBasenames);
  const seen = new Set<string>();
  for (const file of processedFiles) {
    if (typeof file !== "string" || basename(file) !== file || !allowed.has(file)) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_PROCESSED_FILE_OUT_OF_SELECTION:${String(file)}`);
    }
    if (seen.has(file)) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_PROCESSED_FILE_DUPLICATE:${file}`);
    }
    seen.add(file);
  }
}

function assertNonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_COUNT_INVALID:${label}:${String(value)}`);
  }
  return value as number;
}

type ArchiveReconcileCheckpointCell = {
  exact_match: number;
  status_mismatch: number;
  result_kind_mismatch: number;
  archive_only: number;
  canonical_only: number;
  ambiguous_canonical: number;
  parse_failure: number;
  falseRefund: number;
};

const CELL_KEYS = [
  "ambiguous_canonical", "archive_only", "canonical_only", "exact_match", "falseRefund",
  "parse_failure", "result_kind_mismatch", "status_mismatch",
] as const;

function assertCellEntries(value: unknown): Map<string, ArchiveReconcileCheckpointCell> {
  if (!Array.isArray(value)) throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_COUNT_TABLE_INVALID:cells");
  const entries = new Map<string, ArchiveReconcileCheckpointCell>();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
      throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_COUNT_ENTRY_INVALID:cells");
    }
    if (entries.has(entry[0])) throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_COUNT_KEY_DUPLICATE:cells:${entry[0]}`);
    if (typeof entry[1] !== "object" || entry[1] === null || Array.isArray(entry[1])) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_COUNT_ENTRY_INVALID:cells:${entry[0]}`);
    }
    const raw = entry[1] as Record<string, unknown>;
    if (Object.keys(raw).sort().join(",") !== [...CELL_KEYS].sort().join(",")) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_COUNT_ENTRY_INVALID:cells:${entry[0]}`);
    }
    const cell = Object.fromEntries(CELL_KEYS.map((key) => [
      key,
      assertNonNegativeSafeInteger(raw[key], `cells:${entry[0]}:${key}`),
    ])) as ArchiveReconcileCheckpointCell;
    if (cell.canonical_only !== 0) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_CANONICAL_ONLY_PREMATURE:${entry[0]}`);
    }
    if (cell.falseRefund > cell.status_mismatch) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_FALSE_REFUND_INCONSISTENT:${entry[0]}`);
    }
    entries.set(entry[0], cell);
  }
  return entries;
}

function assertFlatCountEntries(value: unknown, label: string): Map<string, number> {
  if (!Array.isArray(value)) throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_COUNT_TABLE_INVALID:${label}`);
  const entries = new Map<string, number>();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_COUNT_ENTRY_INVALID:${label}`);
    }
    if (entries.has(entry[0])) throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_COUNT_KEY_DUPLICATE:${label}:${entry[0]}`);
    entries.set(entry[0], assertNonNegativeSafeInteger(entry[1], `${label}:${entry[0]}`));
  }
  return entries;
}

function assertArchiveReconcileParseErrors(
  checkpointContract: ArchiveReconcileCheckpointContract,
  state: Record<string, unknown>,
  expectedCount: number,
): void {
  const parseErrors = state.parseErrors;
  const processedFiles = state.processedFiles;
  if (!Array.isArray(parseErrors) || !Array.isArray(processedFiles)) {
    throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_PARSE_ERRORS_INVALID");
  }
  if (parseErrors.length !== expectedCount) {
    throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_PARSE_ERROR_COUNT_MISMATCH");
  }
  const selected = new Set(checkpointContract.selectedFileBasenames);
  const processed = new Set(processedFiles as string[]);
  const seen = new Set<string>();
  for (const entry of parseErrors) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_PARSE_ERROR_ENTRY_INVALID");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.file !== "string" || basename(record.file) !== record.file || !selected.has(record.file) || !processed.has(record.file)) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_PARSE_ERROR_FILE_INVALID:${String(record.file)}`);
    }
    if (seen.has(record.file)) throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_PARSE_ERROR_FILE_DUPLICATE:${record.file}`);
    seen.add(record.file);
    if (typeof record.error !== "string" || record.error.length > 300) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_PARSE_ERROR_DETAIL_INVALID:${record.file}`);
    }
  }
}

function assertArchiveReconcileSamples(
  state: Record<string, unknown>,
  expectedMismatchCount: number,
): void {
  const samples = state.samples;
  if (!Array.isArray(samples)) throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_SAMPLES_INVALID");
  const expectedSampleCount = Math.min(MAX_RECONCILE_SAMPLES, expectedMismatchCount);
  if (samples.length !== expectedSampleCount) {
    throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_COUNT_MISMATCH:${samples.length}:${expectedSampleCount}`);
  }
  for (const entry of samples) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_INVALID");
    }
    const sample = entry as Record<string, unknown>;
    const keys = [
      "archiveResultKind", "archiveStatus", "betType", "canonicalResultKind", "canonicalStatus", "class", "raceKey",
    ];
    if (Object.keys(sample).sort().join(",") !== keys.sort().join(",")) {
      throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_INVALID");
    }
    if (typeof sample.raceKey !== "string") throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_RACE_INVALID");
    try {
      parseCanonicalRaceKey(sample.raceKey);
    } catch {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_RACE_INVALID:${sample.raceKey}`);
    }
    if (typeof sample.betType !== "string" || !BET_TYPE_SET.has(sample.betType)) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_BET_TYPE_INVALID:${String(sample.betType)}`);
    }
    if (sample.class !== "status_mismatch" && sample.class !== "result_kind_mismatch") {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_CLASS_INVALID:${String(sample.class)}`);
    }
    if (typeof sample.canonicalStatus !== "string" || !SETTLEMENT_STATUS_SET.has(sample.canonicalStatus)
      || typeof sample.archiveStatus !== "string" || !SETTLEMENT_STATUS_SET.has(sample.archiveStatus)) {
      throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_STATUS_INVALID");
    }
    if (typeof sample.canonicalResultKind !== "string" || !RESULT_KIND_SET.has(sample.canonicalResultKind)
      || typeof sample.archiveResultKind !== "string" || !RESULT_KIND_SET.has(sample.archiveResultKind)) {
      throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_RESULT_KIND_INVALID");
    }
    if (sample.class === "status_mismatch" && sample.canonicalStatus === sample.archiveStatus) {
      throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_CLASS_INCONSISTENT:status_mismatch");
    }
    if (sample.class === "result_kind_mismatch"
      && (sample.canonicalStatus !== sample.archiveStatus || sample.canonicalResultKind === sample.archiveResultKind)) {
      throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_CLASS_INCONSISTENT:result_kind_mismatch");
    }
  }
}

function assertArchiveReconcileAggregateCounts(
  checkpointContract: ArchiveReconcileCheckpointContract,
  state: unknown,
): void {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_STATE_INVALID");
  }
  const record = state as Record<string, unknown>;
  const cells = assertCellEntries(record.cells);
  const paired = assertFlatCountEntries(record.paired, "paired");
  const statusMatrix = assertFlatCountEntries(record.statusMatrix, "statusMatrix");

  let statusMismatchTotal = 0;
  let resultKindMismatchTotal = 0;
  let parseFailureTotal = 0;
  for (const [key, cell] of cells) {
    const expectedPaired = cell.exact_match + cell.status_mismatch + cell.result_kind_mismatch;
    if (!Number.isSafeInteger(expectedPaired) || (paired.get(key) ?? 0) !== expectedPaired) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_PAIRED_COUNT_MISMATCH:${key}`);
    }
    statusMismatchTotal += cell.status_mismatch;
    resultKindMismatchTotal += cell.result_kind_mismatch;
    parseFailureTotal += cell.parse_failure;
  }
  for (const key of paired.keys()) {
    if (!cells.has(key)) throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_PAIRED_COUNT_MISMATCH:${key}`);
  }
  const matrixTotal = [...statusMatrix.values()].reduce((sum, value) => sum + value, 0);
  if (matrixTotal !== statusMismatchTotal) {
    throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_STATUS_MATRIX_MISMATCH");
  }
  assertArchiveReconcileParseErrors(checkpointContract, record, parseFailureTotal);
  assertArchiveReconcileSamples(record, statusMismatchTotal + resultKindMismatchTotal);
}

export function assertArchiveReconcileCheckpointStateDigest(
  actualDigest: unknown,
  checkpointContract: ArchiveReconcileCheckpointContract,
  state: unknown,
): asserts actualDigest is string {
  if (typeof actualDigest !== "string" || !/^[0-9a-f]{64}$/.test(actualDigest)) {
    throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_STATE_DIGEST_MISSING");
  }
  const expectedDigest = buildArchiveReconcileCheckpointStateDigest(checkpointContract, state);
  if (actualDigest !== expectedDigest) {
    throw new Error("ARCHIVE_RECONCILE_CHECKPOINT_STATE_DIGEST_MISMATCH");
  }
  assertArchiveReconcileProcessedFiles(checkpointContract, state);
  assertArchiveReconcileAggregateCounts(checkpointContract, state);
}
