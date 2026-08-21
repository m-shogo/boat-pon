import { basename } from "node:path";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { fileDate } from "./n1Backfill";

export const ARCHIVE_RECONCILE_SELECTION_VERSION = "n2-archive-reconcile-selection-v2";
export const ARCHIVE_RECONCILE_CHECKPOINT_VERSION = "n2-archive-reconcile-checkpoint-v2";
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
}): ArchiveReconcileSelection {
  if (!input.asOf) throw new Error("ARCHIVE_RECONCILE_AS_OF_MISSING");
  const asOf = canonicalUtcTimestamp(input.asOf);
  const cutoffDate = lastCompletedJstRaceDate(asOf);
  const dated = input.discoveredFiles.map((path) => {
    const file = basename(path);
    const date = fileDate(path);
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
  const inventoryDigest = canonicalHash(selected.map((entry) => entry.file));
  return {
    asOf,
    cutoffDate,
    eligibleFiles: eligible.map((entry) => entry.path),
    selectedFiles,
    inventoryDigest,
  };
}

export function archiveReconcileCheckpointContract(selection: ArchiveReconcileSelection): ArchiveReconcileCheckpointContract {
  return {
    checkpointVersion: ARCHIVE_RECONCILE_CHECKPOINT_VERSION,
    selectionVersion: ARCHIVE_RECONCILE_SELECTION_VERSION,
    asOf: selection.asOf,
    inventoryDigest: selection.inventoryDigest,
    selectedFileCount: selection.selectedFiles.length,
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
    if (record[key] !== value) {
      throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_CONTRACT_MISMATCH:${key}`);
    }
  }
}
