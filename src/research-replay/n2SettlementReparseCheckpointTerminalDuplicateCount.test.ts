import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_SETTLEMENT_REPARSE_CHECKPOINT_VERSION,
  assertN2SettlementReparseCheckpointStateDigest,
  buildN2SettlementReparseCheckpointStateDigest,
  type N2SettlementReparseCheckpointIdentity,
} from "./n2SettlementReparseCheckpoint";

const identity: N2SettlementReparseCheckpointIdentity = {
  checkpointVersion: N2_SETTLEMENT_REPARSE_CHECKPOINT_VERSION,
  reparseSchemaVersion: "n2-settlement-reparse-v1",
  sourceParserVersion: "source-v1",
  targetParserVersion: "target-v2",
  canonicalizationVersion: "canonical-v1",
  raceIdentityVersion: "race-v1",
  asOf: "2026-08-01T00:00:00.000Z",
  mode: "simulated",
  canary: false,
  filesLimit: null,
  sourcePath: "/tmp/source.sqlite",
  sourceSidecarSha256: "a".repeat(64),
  targetPath: "/tmp/target.sqlite",
  archiveRoot: "/tmp/archive",
  selectedFilesDigest: "b".repeat(64),
  selectedFileBasenames: ["k260801.lzh", "k260802.lzh"],
};

const counts = {
  files_scanned: 2,
  files_ingested: 1,
  files_not_ingested: 0,
  files_duplicate_source: 1,
  parse_errors: 0,
  appended_candidates: 0,
  appended_parse_runs: 0,
  appended_observations: 0,
  supersession_relations: 0,
  ambiguous_active: 0,
  fr_from_refunded: 0,
  fr_from_partial: 0,
  exact: 0,
  false_refund_correction: 0,
  result_kind_correction: 0,
  special_payout_addition: 0,
  ambiguous_non_defect: 0,
  unexpected_addition: 0,
};

const baseState = {
  version: "n2-settlement-reparse-v1",
  counts,
  corrections: [],
  processedFiles: ["k260801.lzh"],
  processedRawDocs: ["raw-1"],
  byYear: [["2026", { false_refund: 0, result_kind: 0, special_addition: 0 }]],
  byBetType: [],
};

function assertValid(state: unknown): void {
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, state);
  assert.doesNotThrow(() => assertN2SettlementReparseCheckpointStateDigest(digest, identity, state));
}

function assertCountMismatch(state: unknown): void {
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, state);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, state),
    /REPARSE_CHECKPOINT_TERMINAL_DUPLICATE_COUNT_MISMATCH/,
  );
}

test("modern reparse checkpoint binds terminal duplicate evidence to duplicate count", () => {
  assertValid({ ...baseState, terminalDuplicateFiles: ["k260802.lzh"] });
  assertCountMismatch({ ...baseState, terminalDuplicateFiles: [] });
  assertCountMismatch({ ...baseState, terminalDuplicateFiles: ["k260801.lzh", "k260802.lzh"] });
});

test("legacy reparse checkpoint without terminal duplicate field remains compatible", () => {
  assertValid(baseState);
});
