export type N2SettlementReparseProcessedLineageState = {
  processedFiles: readonly string[];
  processedRawDocs: readonly string[];
};

export function assertN2SettlementReparseProcessedArchiveLineage(
  state: N2SettlementReparseProcessedLineageState,
  expectedRawDocumentIdByArchive: ReadonlyMap<string, string>,
): void {
  if (state.processedFiles.length !== state.processedRawDocs.length) {
    throw new Error("REPARSE_CHECKPOINT_PROCESSED_LINEAGE_COUNT_MISMATCH");
  }
  for (let index = 0; index < state.processedFiles.length; index += 1) {
    const archiveFile = state.processedFiles[index];
    const savedRawDocumentId = state.processedRawDocs[index];
    const expectedRawDocumentId = expectedRawDocumentIdByArchive.get(archiveFile);
    if (expectedRawDocumentId === undefined) {
      throw new Error(`REPARSE_CHECKPOINT_PROCESSED_ARCHIVE_RAW_UNRESOLVED:${archiveFile}`);
    }
    if (savedRawDocumentId !== expectedRawDocumentId) {
      throw new Error(
        `REPARSE_CHECKPOINT_PROCESSED_ARCHIVE_RAW_MISMATCH:${archiveFile}:${savedRawDocumentId}:${expectedRawDocumentId}`,
      );
    }
  }
}
