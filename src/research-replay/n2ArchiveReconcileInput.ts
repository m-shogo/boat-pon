import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { canonicalHash, canonicalUtcTimestamp, sha256Bytes } from "./canonical";
import { fileDate } from "./n1Backfill";

export const ARCHIVE_RECONCILE_SELECTION_VERSION = "n2-archive-reconcile-selection-v3";
export const ARCHIVE_RECONCILE_CHECKPOINT_VERSION = "n2-archive-reconcile-checkpoint-v6";
export const ARCHIVE_RECONCILE_CHECKPOINT_STATE_DIGEST_VERSION = "n2-archive-reconcile-checkpoint-state-digest-v1";
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

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
  // K archives are complete Japanese race-day files. Never ingest the JST calendar
  // day that is still in progress at asOf; the latest safe archive day is yesterday JST.
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
}
