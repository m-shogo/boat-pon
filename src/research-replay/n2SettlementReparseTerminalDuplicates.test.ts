import assert from "node:assert/strict";
import test from "node:test";

import {
  assertN2SettlementReparseTerminalDuplicateLineage,
  n2SettlementReparseDoneFiles,
  normalizeN2SettlementReparseTerminalDuplicateFiles,
} from "./n2SettlementReparseTerminalDuplicates";

test("reparse resume treats verified terminal duplicate-source archives as done", () => {
  const terminal = normalizeN2SettlementReparseTerminalDuplicateFiles({
    value: ["k260802.lzh"],
    selectedFileBasenames: ["k260801.lzh", "k260802.lzh", "k260803.lzh"],
    processedFiles: ["k260801.lzh"],
  });
  assert.doesNotThrow(() => assertN2SettlementReparseTerminalDuplicateLineage({
    terminalDuplicateFiles: terminal,
    processedRawDocs: ["raw-1"],
    rawDocumentIdByArchive: new Map([["k260802.lzh", "raw-1"]]),
  }));
  assert.deepEqual([...n2SettlementReparseDoneFiles(["k260801.lzh"], terminal)].sort(), [
    "k260801.lzh",
    "k260802.lzh",
  ]);
  assert.equal(n2SettlementReparseDoneFiles(["k260801.lzh"], terminal).has("k260803.lzh"), false);
});

test("old reparse checkpoints without terminal duplicate state remain compatible", () => {
  assert.deepEqual(normalizeN2SettlementReparseTerminalDuplicateFiles({
    value: undefined,
    selectedFileBasenames: ["k260801.lzh"],
    processedFiles: [],
  }), []);
});

test("reparse resume rejects tampered terminal duplicate file evidence", () => {
  assert.throws(() => normalizeN2SettlementReparseTerminalDuplicateFiles({
    value: ["k260999.lzh"],
    selectedFileBasenames: ["k260801.lzh"],
    processedFiles: [],
  }), /REPARSE_CHECKPOINT_TERMINAL_DUPLICATE_OUT_OF_SELECTION/);
  assert.throws(() => normalizeN2SettlementReparseTerminalDuplicateFiles({
    value: ["k260801.lzh"],
    selectedFileBasenames: ["k260801.lzh"],
    processedFiles: ["k260801.lzh"],
  }), /REPARSE_CHECKPOINT_TERMINAL_DUPLICATE_ALREADY_PROCESSED/);
});

test("reparse resume rejects terminal files that do not resolve to processed raw lineage", () => {
  assert.throws(() => assertN2SettlementReparseTerminalDuplicateLineage({
    terminalDuplicateFiles: ["k260802.lzh"],
    processedRawDocs: ["raw-1"],
    rawDocumentIdByArchive: new Map([["k260802.lzh", "raw-2"]]),
  }), /REPARSE_CHECKPOINT_TERMINAL_DUPLICATE_RAW_MISMATCH:k260802\.lzh:raw-2/);
  assert.throws(() => assertN2SettlementReparseTerminalDuplicateLineage({
    terminalDuplicateFiles: ["k260802.lzh"],
    processedRawDocs: ["raw-1"],
    rawDocumentIdByArchive: new Map(),
  }), /REPARSE_CHECKPOINT_TERMINAL_DUPLICATE_RAW_UNRESOLVED:k260802\.lzh/);
});
