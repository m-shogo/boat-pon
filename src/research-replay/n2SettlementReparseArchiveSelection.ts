import { basename } from "node:path";

import { fileDate } from "./n1Backfill";

export function assertN2SettlementReparseArchiveSelection(files: readonly string[]): void {
  const seenBasenames = new Set<string>();
  for (const file of files) {
    const archiveFile = basename(file);
    try {
      fileDate(file);
    } catch {
      throw new Error(`REPARSE_ARCHIVE_DATE_INVALID:${archiveFile}`);
    }
    const checkpointKey = archiveFile.toLowerCase();
    if (seenBasenames.has(checkpointKey)) {
      throw new Error(`REPARSE_ARCHIVE_BASENAME_DUPLICATE:${archiveFile}`);
    }
    seenBasenames.add(checkpointKey);
  }
}
