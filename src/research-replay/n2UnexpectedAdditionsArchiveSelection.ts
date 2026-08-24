import { basename } from "node:path";
import { fileDate } from "./n1Backfill";

function requireUnexpectedAdditionsLimit(limit: number | null): void {
  if (limit !== null && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new Error(`N2_UNEXPECTED_ADDITIONS_LIMIT_INVALID:${String(limit)}`);
  }
}

export function parseUnexpectedAdditionsLimit(value: string | null): number | null {
  if (value == null) return null;
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`N2_UNEXPECTED_ADDITIONS_LIMIT_INVALID:${value}`);
  }
  const parsed = Number(value);
  requireUnexpectedAdditionsLimit(parsed);
  return parsed;
}

export function selectUnexpectedAdditionsArchives(files: string[], limit: number | null): string[] {
  requireUnexpectedAdditionsLimit(limit);
  const seenBasenames = new Set<string>();
  for (const file of files) {
    fileDate(file);
    const archiveBasename = basename(file);
    const archiveIdentity = archiveBasename.toLowerCase();
    if (seenBasenames.has(archiveIdentity)) {
      throw new Error(`N2_UNEXPECTED_ADDITIONS_ARCHIVE_BASENAME_DUPLICATE:${archiveBasename}`);
    }
    seenBasenames.add(archiveIdentity);
  }
  return limit == null ? files : files.slice(0, limit);
}
