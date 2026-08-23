import { fileDate } from "./n1Backfill";

export function selectRefundAuditArchives(files: string[], limit: number | null): string[] {
  if (limit !== null && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new Error(`N1_REFUND_AUDIT_LIMIT_INVALID:${String(limit)}`);
  }
  for (const file of files) fileDate(file);
  return limit == null ? files : files.slice(0, limit);
}
