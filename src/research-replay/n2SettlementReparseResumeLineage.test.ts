import assert from "node:assert/strict";
import test from "node:test";

import { assertN2SettlementReparseProcessedArchiveLineage } from "./n2SettlementReparseResumeLineage";

const state = {
  processedFiles: ["k260801.lzh", "k260802.lzh"],
  processedRawDocs: ["raw-1", "raw-2"],
};

test("reparse resume accepts raw lineage derived from the processed archive bytes", () => {
  assert.doesNotThrow(() => assertN2SettlementReparseProcessedArchiveLineage(
    state,
    new Map([
      ["k260801.lzh", "raw-1"],
      ["k260802.lzh", "raw-2"],
    ]),
  ));
});

test("reparse resume rejects rehashed raw lineage swapped across processed archives", () => {
  assert.throws(
    () => assertN2SettlementReparseProcessedArchiveLineage(
      { ...state, processedRawDocs: ["raw-2", "raw-1"] },
      new Map([
        ["k260801.lzh", "raw-1"],
        ["k260802.lzh", "raw-2"],
      ]),
    ),
    /REPARSE_CHECKPOINT_PROCESSED_ARCHIVE_RAW_MISMATCH:k260801\.lzh:raw-2:raw-1/,
  );
});

test("reparse resume rejects processed archives that no longer resolve to current raw lineage", () => {
  assert.throws(
    () => assertN2SettlementReparseProcessedArchiveLineage(
      state,
      new Map([["k260801.lzh", "raw-1"]]),
    ),
    /REPARSE_CHECKPOINT_PROCESSED_ARCHIVE_RAW_UNRESOLVED:k260802\.lzh/,
  );
});
