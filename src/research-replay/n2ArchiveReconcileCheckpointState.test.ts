import assert from "node:assert/strict";
import test from "node:test";

import { RECONCILE_INPUT_VERSION } from "./n2ArchiveCanonicalReconcile";
import {
  ARCHIVE_RECONCILE_CHECKPOINT_VERSION,
  ARCHIVE_RECONCILE_SELECTION_VERSION,
  assertArchiveReconcileCheckpointStateDigest,
  buildArchiveReconcileCheckpointStateDigest,
  type ArchiveReconcileCheckpointContract,
} from "./n2ArchiveReconcileInput";

const contract: ArchiveReconcileCheckpointContract = {
  checkpointVersion: ARCHIVE_RECONCILE_CHECKPOINT_VERSION,
  selectionVersion: ARCHIVE_RECONCILE_SELECTION_VERSION,
  asOf: "2026-08-01T00:00:00.000Z",
  inventoryDigest: "a".repeat(64),
  selectedFileCount: 2,
  selectedFileBasenames: ["k260730.lzh", "k260731.lzh"],
  sourceSidecarSha256: "b".repeat(64),
};

const emptyCell = {
  exact_match: 0,
  status_mismatch: 0,
  result_kind_mismatch: 0,
  archive_only: 0,
  canonical_only: 0,
  ambiguous_canonical: 0,
  parse_failure: 0,
  falseRefund: 0,
};

const statusMismatchSample = {
  raceKey: "2026-07-30:01:R1",
  betType: "trifecta",
  class: "status_mismatch",
  canonicalStatus: "refunded",
  canonicalResultKind: "normal",
  archiveStatus: "settled",
  archiveResultKind: "normal",
};

const state = {
  version: RECONCILE_INPUT_VERSION,
  cells: [],
  paired: [],
  statusMatrix: [],
  samples: [],
  processedFiles: ["k260730.lzh"],
  parseErrors: [],
  ambiguousKeys: [],
};

test("archive reconcile checkpoint state digest binds processed-file resume state", () => {
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, state);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.doesNotThrow(() => assertArchiveReconcileCheckpointStateDigest(digest, contract, state));

  const tampered = { ...state, processedFiles: ["k260730.lzh", "k260731.lzh"] };
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_STATE_DIGEST_MISMATCH/,
  );
});

test("archive reconcile resume accepts producer-consistent paired counts", () => {
  const key = "2026\u0000trifecta\u0000Toda";
  const pairedState = {
    ...state,
    cells: [[key, { ...emptyCell, exact_match: 1 }]],
    paired: [[key, 1]],
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, pairedState);
  assert.doesNotThrow(() => assertArchiveReconcileCheckpointStateDigest(digest, contract, pairedState));
});

test("archive reconcile resume accepts producer-consistent mismatch samples", () => {
  const key = "2026\u0000trifecta\u0000Toda";
  const mismatchState = {
    ...state,
    cells: [[key, { ...emptyCell, status_mismatch: 1 }]],
    paired: [[key, 1]],
    statusMatrix: [["refunded->settled", 1]],
    samples: [statusMismatchSample],
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, mismatchState);
  assert.doesNotThrow(() => assertArchiveReconcileCheckpointStateDigest(digest, contract, mismatchState));
});

test("archive reconcile resume rejects rehashed mismatch sample deletion", () => {
  const key = "2026\u0000trifecta\u0000Toda";
  const tampered = {
    ...state,
    cells: [[key, { ...emptyCell, status_mismatch: 1 }]],
    paired: [[key, 1]],
    statusMatrix: [["refunded->settled", 1]],
    samples: [],
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, tampered);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_COUNT_MISMATCH:0:1/,
  );
});

test("archive reconcile resume rejects rehashed impossible mismatch samples", () => {
  const key = "2026\u0000trifecta\u0000Toda";
  const tampered = {
    ...state,
    cells: [[key, { ...emptyCell, status_mismatch: 1 }]],
    paired: [[key, 1]],
    statusMatrix: [["refunded->settled", 1]],
    samples: [{ ...statusMismatchSample, canonicalStatus: "settled" }],
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, tampered);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_SAMPLE_CLASS_INCONSISTENT:status_mismatch/,
  );
});

test("archive reconcile resume rejects rehashed processed files outside selected inventory", () => {
  const tampered = { ...state, processedFiles: ["k260731.lzh", "k260801.lzh"] };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, tampered);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_PROCESSED_FILE_OUT_OF_SELECTION:k260801\.lzh/,
  );
});

test("archive reconcile resume rejects rehashed duplicate processed files", () => {
  const tampered = { ...state, processedFiles: ["k260730.lzh", "k260730.lzh"] };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, tampered);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_PROCESSED_FILE_DUPLICATE:k260730\.lzh/,
  );
});

test("archive reconcile resume rejects rehashed negative aggregate counts", () => {
  const tampered = {
    ...state,
    cells: [["2026\u0000trifecta\u0000Toda", { ...emptyCell, exact_match: -1 }]],
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, tampered);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_COUNT_INVALID:cells:.*:exact_match:-1/,
  );
});

test("archive reconcile resume rejects rehashed unsafe aggregate counts", () => {
  const tampered = {
    ...state,
    paired: [["2026\u0000trifecta\u0000Toda", Number.MAX_SAFE_INTEGER + 1]],
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, tampered);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_COUNT_INVALID:paired:.*:9007199254740992/,
  );
});

test("archive reconcile resume rejects duplicate aggregate keys even after rehash", () => {
  const key = "2026\u0000trifecta\u0000Toda";
  const tampered = {
    ...state,
    paired: [[key, 1], [key, 2]],
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, tampered);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_COUNT_KEY_DUPLICATE:paired:/,
  );
});

test("archive reconcile resume rejects rehashed paired-count drift", () => {
  const key = "2026\u0000trifecta\u0000Toda";
  const tampered = {
    ...state,
    cells: [[key, { ...emptyCell, exact_match: 1 }]],
    paired: [],
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, tampered);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_PAIRED_COUNT_MISMATCH:/,
  );
});

test("archive reconcile resume rejects canonical-only counts before final derivation", () => {
  const key = "2026\u0000trifecta\u0000Toda";
  const tampered = {
    ...state,
    cells: [[key, { ...emptyCell, canonical_only: 1 }]],
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, tampered);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_CANONICAL_ONLY_PREMATURE:/,
  );
});

test("archive reconcile resume rejects status-matrix drift", () => {
  const key = "2026\u0000trifecta\u0000Toda";
  const tampered = {
    ...state,
    cells: [[key, { ...emptyCell, status_mismatch: 1 }]],
    paired: [[key, 1]],
    statusMatrix: [],
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, tampered);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_STATUS_MATRIX_MISMATCH/,
  );
});

test("archive reconcile resume rejects parse-error evidence deletion", () => {
  const key = "2026\u0000-\u0000-";
  const producerState = {
    ...state,
    cells: [[key, { ...emptyCell, parse_failure: 1 }]],
    parseErrors: [{ file: "k260730.lzh", error: "synthetic parse failure" }],
  };
  const producerDigest = buildArchiveReconcileCheckpointStateDigest(contract, producerState);
  assert.doesNotThrow(() => assertArchiveReconcileCheckpointStateDigest(producerDigest, contract, producerState));

  const tampered = { ...producerState, parseErrors: [] };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, tampered);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_PARSE_ERROR_COUNT_MISMATCH/,
  );
});

test("archive reconcile resume rejects missing or non-canonical state digests", () => {
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(undefined, contract, state),
    /ARCHIVE_RECONCILE_CHECKPOINT_STATE_DIGEST_MISSING/,
  );
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest("ABC", contract, state),
    /ARCHIVE_RECONCILE_CHECKPOINT_STATE_DIGEST_MISSING/,
  );
});
