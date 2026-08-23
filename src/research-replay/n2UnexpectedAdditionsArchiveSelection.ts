import { basename } from "node:path";
import { fileDate } from "./n1Backfill";

export function parseUnexpectedAdditionsLimit(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`N2_UNEXPECTED_ADDITIONS_LIMIT_INVALID:${value}`);
  }
  return parsed;
}

export function selectUnexpectedAdditionsArchives(files: string[], limit: number | null): string[] {
  const seenBasenames = new Set<string>();
  for (const file of files) {
    fileDate(file);
    const archiveBasename = basename(file);
    if (seenBasenames.has(archiveBasename)) {
      throw new Error(`N2_UNEXPECTED_ADDITIONS_ARCHIVE_BASENAME_DUPLICATE:${archiveBasename}`);
    }
    seenBasenames.add(archiveBasename);
  }
  return limit == null ? files : files.slice(0, limit);
}
