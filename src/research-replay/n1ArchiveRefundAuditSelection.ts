import { basename } from "node:path";
import { fileDate } from "./n1Backfill";

export function selectRefundAuditArchives(files: string[], limit: number | null): string[] {
  if (limit !== null && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new Error(`N1_REFUND_AUDIT_LIMIT_INVALID:${String(limit)}`);
  }
  const seenBasenames = new Set<string>();
  for (const file of files) {
    fileDate(file);
    const archiveBasename = basename(file);
    const archiveIdentity = archiveBasename.toLowerCase();
    if (seenBasenames.has(archiveIdentity)) {
      throw new Error(`N1_REFUND_AUDIT_ARCHIVE_BASENAME_DUPLICATE:${archiveBasename}`);
    }
    seenBasenames.add(archiveIdentity);
  }
  return limit == null ? files : files.slice(0, limit);
}
