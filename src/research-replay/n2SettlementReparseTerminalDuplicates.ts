import { basename } from "node:path";

export function normalizeN2SettlementReparseTerminalDuplicateFiles(input: {
  value: unknown;
  selectedFileBasenames: readonly string[];
  processedFiles: readonly string[];
}): string[] {
  if (input.value === undefined) return [];
  if (!Array.isArray(input.value)) {
    throw new Error("REPARSE_CHECKPOINT_TERMINAL_DUPLICATES_INVALID");
  }
  const selected = new Set(input.selectedFileBasenames);
  const processed = new Set(input.processedFiles);
  const seen = new Set<string>();
  const files: string[] = [];
  for (const value of input.value) {
    if (typeof value !== "string" || basename(value) !== value || !selected.has(value)) {
      throw new Error(`REPARSE_CHECKPOINT_TERMINAL_DUPLICATE_OUT_OF_SELECTION:${String(value)}`);
    }
    if (processed.has(value)) {
      throw new Error(`REPARSE_CHECKPOINT_TERMINAL_DUPLICATE_ALREADY_PROCESSED:${value}`);
    }
    if (seen.has(value)) {
      throw new Error(`REPARSE_CHECKPOINT_TERMINAL_DUPLICATE_REPEATED:${value}`);
    }
    seen.add(value);
    files.push(value);
  }
  return files;
}

export function assertN2SettlementReparseTerminalDuplicateLineage(input: {
  terminalDuplicateFiles: readonly string[];
  processedRawDocs: readonly string[];
  rawDocumentIdByArchive: ReadonlyMap<string, string>;
}): void {
  const processedRawDocs = new Set(input.processedRawDocs);
  for (const archiveFile of input.terminalDuplicateFiles) {
    const rawDocumentId = input.rawDocumentIdByArchive.get(archiveFile);
    if (rawDocumentId === undefined) {
      throw new Error(`REPARSE_CHECKPOINT_TERMINAL_DUPLICATE_RAW_UNRESOLVED:${archiveFile}`);
    }
    if (!processedRawDocs.has(rawDocumentId)) {
      throw new Error(`REPARSE_CHECKPOINT_TERMINAL_DUPLICATE_RAW_MISMATCH:${archiveFile}:${rawDocumentId}`);
    }
  }
}

export function n2SettlementReparseDoneFiles(
  processedFiles: readonly string[],
  terminalDuplicateFiles: readonly string[],
): Set<string> {
  return new Set([...processedFiles, ...terminalDuplicateFiles]);
}
