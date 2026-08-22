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

const state = {
  version: "n2-settlement-reparse-v1",
  counts: {
    files_scanned: 1,
    files_ingested: 1,
    files_not_ingested: 0,
    files_duplicate_source: 0,
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
  },
  corrections: [],
  processedFiles: ["k260801.lzh"],
  processedRawDocs: ["raw-1"],
  byYear: [["2026", { false_refund: 0, result_kind: 0, special_addition: 0 }]],
  byBetType: [],
};

const validCorrectionState = {
  ...state,
  counts: {
    ...state.counts,
    appended_candidates: 1,
    special_payout_addition: 1,
  },
  corrections: [{
    raceKey: "2026-08-01:01:R1",
    betType: "trifecta",
    action: "special_payout_addition",
    originalStatus: null,
    correctedStatus: "settled",
    originalResultKind: null,
    correctedResultKind: "special_payout",
    defectCode: "V1_SPECIAL_PAYOUT_FALSE_REFUND",
  }],
  byYear: [["2026", { false_refund: 0, result_kind: 0, special_addition: 1 }]],
  byBetType: [["trifecta", { false_refund: 0, result_kind: 0, special_addition: 1 }]],
};

test("reparse checkpoint state digest is bound to checkpoint identity and state", () => {
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, state);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.doesNotThrow(() => assertN2SettlementReparseCheckpointStateDigest(digest, identity, state));

  const tampered = { ...state, processedFiles: ["k260801.lzh", "k260802.lzh"] };
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_STATE_DIGEST_MISMATCH/,
  );
});

test("reparse checkpoint resume accepts producer-consistent correction samples", () => {
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, validCorrectionState);
  assert.doesNotThrow(() => assertN2SettlementReparseCheckpointStateDigest(digest, identity, validCorrectionState));
});

test("reparse checkpoint resume rejects rehashed processed files outside selected inventory", () => {
  const tampered = { ...state, processedFiles: ["k260801.lzh", "k260803.lzh"] };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_PROCESSED_FILE_OUT_OF_SELECTION:k260803\.lzh/,
  );
});

test("reparse checkpoint resume rejects rehashed duplicate processed files", () => {
  const tampered = { ...state, processedFiles: ["k260801.lzh", "k260801.lzh"] };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_PROCESSED_FILE_DUPLICATE:k260801\.lzh/,
  );
});

test("reparse checkpoint resume rejects rehashed aggregate count drift", () => {
  const tampered = { ...state, counts: { ...state.counts, files_scanned: 2 } };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_FILE_COUNTS_INCONSISTENT/,
  );
});

test("reparse checkpoint resume rejects unsafe aggregate counts", () => {
  const tampered = { ...state, counts: { ...state.counts, appended_candidates: Number.MAX_SAFE_INTEGER + 1 } };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_COUNT_INVALID:appended_candidates/,
  );
});

test("reparse checkpoint resume requires every producer count field", () => {
  const counts = { ...state.counts } as Record<string, number>;
  delete counts.unexpected_addition;
  const tampered = { ...state, counts };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_COUNTS_SHAPE_INVALID/,
  );
});

test("reparse checkpoint resume rejects unknown count fields", () => {
  const tampered = { ...state, counts: { ...state.counts, invented_counter: 0 } };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_COUNTS_SHAPE_INVALID/,
  );
});

test("reparse checkpoint resume binds ingested count to processed lineage", () => {
  const tampered = { ...state, processedRawDocs: [] };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_PROCESSED_LINEAGE_COUNT_MISMATCH/,
  );
});

test("reparse checkpoint resume rejects duplicate processed raw lineage", () => {
  const twoFileState = {
    ...state,
    counts: { ...state.counts, files_scanned: 2, files_ingested: 2 },
    processedFiles: ["k260801.lzh", "k260802.lzh"],
    processedRawDocs: ["raw-1", "raw-1"],
  };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, twoFileState);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, twoFileState),
    /REPARSE_CHECKPOINT_PROCESSED_RAW_DUPLICATE:raw-1/,
  );
});

test("reparse checkpoint resume rejects rehashed report totals", () => {
  const tampered = {
    ...state,
    counts: { ...state.counts, appended_candidates: 1 },
    corrections: [{}],
    byYear: [["2026", { false_refund: 0, result_kind: 0, special_addition: 0 }]],
    byBetType: [["trifecta", { false_refund: 0, result_kind: 0, special_addition: 0 }]],
  };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_REPORT_TOTAL_MISMATCH/,
  );
});

test("reparse checkpoint resume rejects duplicate report aggregate keys", () => {
  const tampered = {
    ...state,
    byYear: [
      ["2026", { false_refund: 0, result_kind: 0, special_addition: 0 }],
      ["2026", { false_refund: 0, result_kind: 0, special_addition: 0 }],
    ],
  };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_REPORT_KEY_DUPLICATE:byYear:2026/,
  );
});

test("reparse checkpoint resume binds correction samples to appended candidates", () => {
  const tampered = { ...state, corrections: [{}] };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_CORRECTION_COUNT_MISMATCH/,
  );
});

test("reparse checkpoint resume rejects correction samples outside report aggregates", () => {
  const tampered = {
    ...validCorrectionState,
    corrections: [{ ...validCorrectionState.corrections[0], raceKey: "2025-08-01:01:R1" }],
  };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_CORRECTION_AGGREGATE_MISMATCH:byYear:2025:special_addition:0/,
  );
});

test("reparse checkpoint resume rejects correction action semantic drift", () => {
  const tampered = {
    ...validCorrectionState,
    corrections: [{
      ...validCorrectionState.corrections[0],
      action: "result_kind_correction",
      originalStatus: "refunded",
      correctedStatus: "settled",
      originalResultKind: "normal",
    }],
  };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_CORRECTION_INVALID:0:resultKind/,
  );
});

test("reparse checkpoint resume rejects correction defect-code drift", () => {
  const tampered = {
    ...validCorrectionState,
    corrections: [{ ...validCorrectionState.corrections[0], defectCode: "OTHER_DEFECT" }],
  };
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, tampered);
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(digest, identity, tampered),
    /REPARSE_CHECKPOINT_CORRECTION_INVALID:0:defectCode/,
  );
});

test("reparse checkpoint resume rejects checkpoints without a canonical state digest", () => {
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest(undefined, identity, state),
    /REPARSE_CHECKPOINT_STATE_DIGEST_MISSING/,
  );
  assert.throws(
    () => assertN2SettlementReparseCheckpointStateDigest("ABC", identity, state),
    /REPARSE_CHECKPOINT_STATE_DIGEST_MISSING/,
  );
});
