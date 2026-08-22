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
  selectedFileCount: 1,
  selectedFileBasenames: ["k260730.lzh"],
  sourceSidecarSha256: "b".repeat(64),
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

const cell = {
  exact_match: 0,
  status_mismatch: 1,
  result_kind_mismatch: 0,
  archive_only: 0,
  canonical_only: 0,
  ambiguous_canonical: 0,
  parse_failure: 0,
  falseRefund: 1,
};

const aggregateKey = "2026\u0000trifecta\u0000戸田";
const state = {
  version: RECONCILE_INPUT_VERSION,
  cells: [[aggregateKey, cell]],
  paired: [[aggregateKey, 1]],
  statusMatrix: [["refunded->settled", 1]],
  samples: [statusMismatchSample],
  processedFiles: ["k260730.lzh"],
  parseErrors: [],
  ambiguousKeys: [],
};

function assertState(candidate: unknown): void {
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, candidate);
  assertArchiveReconcileCheckpointStateDigest(digest, contract, candidate);
}

test("archive reconcile resume accepts producer-consistent status evidence", () => {
  assert.doesNotThrow(() => assertState(state));
});

test("archive reconcile resume rejects rehashed false-refund transition drift", () => {
  const tampered = { ...state, statusMatrix: [["settled->refunded", 1]] };
  assert.throws(
    () => assertState(tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_FALSE_REFUND_MATRIX_MISMATCH/,
  );
});

test("archive reconcile resume rejects impossible status transitions", () => {
  const tampered = { ...state, statusMatrix: [["refunded->refunded", 1]] };
  assert.throws(
    () => assertState(tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_STATUS_MATRIX_ENTRY_INVALID:/,
  );
});

test("archive reconcile resume rejects zero-count transition evidence", () => {
  const tampered = {
    ...state,
    statusMatrix: [["refunded->settled", 0]],
  };
  assert.throws(
    () => assertState(tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_STATUS_MATRIX_ENTRY_INVALID:/,
  );
});