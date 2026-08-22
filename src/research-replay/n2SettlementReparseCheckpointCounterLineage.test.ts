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
  selectedFileBasenames: ["k260801.lzh"],
};

const state = {
  version: "n2-settlement-reparse-v1",
  counts: {
    files_scanned: 1,
    files_ingested: 1,
    files_not_ingested: 0,
    files_duplicate_source: 0,
    parse_errors: 0,
    appended_candidates: 1,
    appended_parse_runs: 1,
    appended_observations: 1,
    supersession_relations: 1,
    ambiguous_active: 0,
    fr_from_refunded: 1,
    fr_from_partial: 0,
    exact: 0,
    false_refund_correction: 1,
    result_kind_correction: 0,
    special_payout_addition: 0,
    ambiguous_non_defect: 0,
    unexpected_addition: 0,
  },
  corrections: [{
    raceKey: "2026-08-01:01:R1",
    betType: "trifecta",
    action: "false_refund_correction",
    originalStatus: "refunded",
    correctedStatus: "settled",
    originalResultKind: "normal",
    correctedResultKind: "normal",
    defectCode: "V1_SPECIAL_PAYOUT_FALSE_REFUND",
  }],
  processedFiles: ["k260801.lzh"],
  processedRawDocs: ["raw-1"],
  byYear: [["2026", { false_refund: 1, result_kind: 0, special_addition: 0 }]],
  byBetType: [["trifecta", { false_refund: 1, result_kind: 0, special_addition: 0 }]],
};

function validate(value: typeof state): void {
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, value);
  assertN2SettlementReparseCheckpointStateDigest(digest, identity, value);
}

test("reparse checkpoint accepts producer-consistent supersession accounting", () => {
  assert.doesNotThrow(() => validate(state));
});

test("reparse checkpoint rejects rehashed supersession count drift", () => {
  const tampered = {
    ...state,
    counts: { ...state.counts, supersession_relations: 0 },
  };
  assert.throws(
    () => validate(tampered),
    /REPARSE_CHECKPOINT_SUPERSESSION_COUNT_MISMATCH/,
  );
});

test("reparse checkpoint rejects rehashed false-refund source count drift", () => {
  const tampered = {
    ...state,
    counts: { ...state.counts, fr_from_refunded: 0 },
  };
  assert.throws(
    () => validate(tampered),
    /REPARSE_CHECKPOINT_FALSE_REFUND_SOURCE_COUNT_MISMATCH/,
  );
});
