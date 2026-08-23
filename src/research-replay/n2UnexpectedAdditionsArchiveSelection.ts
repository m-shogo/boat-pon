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
  for (const file of files) fileDate(file);
  return limit == null ? files : files.slice(0, limit);
}
