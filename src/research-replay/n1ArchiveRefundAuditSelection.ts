import { fileDate } from "./n1Backfill";

export function selectRefundAuditArchives(files: string[], limit: number | null): string[] {
  for (const file of files) fileDate(file);
  return limit == null ? files : files.slice(0, limit);
}
