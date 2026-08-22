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

const cell = {
  exact_match: 0,
  status_mismatch: 0,
  result_kind_mismatch: 0,
  archive_only: 0,
  canonical_only: 0,
  ambiguous_canonical: 1,
  parse_failure: 0,
  falseRefund: 0,
};

const aggregateKey = "2026\u0000trifecta\u0000戸田";
const ambiguousKey = "2026-07-30:01:R1\u0000trifecta";

const state = {
  version: RECONCILE_INPUT_VERSION,
  cells: [[aggregateKey, cell]],
  paired: [],
  statusMatrix: [],
  samples: [],
  processedFiles: ["k260730.lzh"],
  parseErrors: [],
  ambiguousKeys: [ambiguousKey],
};

function assertState(candidate: unknown): void {
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, candidate);
  assertArchiveReconcileCheckpointStateDigest(digest, contract, candidate);
}

test("archive reconcile resume accepts producer-consistent ambiguous evidence", () => {
  assert.doesNotThrow(() => assertState(state));
});

test("archive reconcile resume rejects rehashed ambiguous evidence deletion", () => {
  const tampered = { ...state, ambiguousKeys: [] };
  assert.throws(
    () => assertState(tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_AMBIGUOUS_KEY_COUNT_MISMATCH:0:1/,
  );
});

test("archive reconcile resume rejects malformed ambiguous lineage keys", () => {
  const tampered = { ...state, ambiguousKeys: ["2026-02-30:01:R1\u0000trifecta"] };
  assert.throws(
    () => assertState(tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_AMBIGUOUS_KEY_INVALID:/,
  );
});

test("archive reconcile resume rejects duplicate ambiguous lineage keys", () => {
  const tampered = {
    ...state,
    cells: [[aggregateKey, { ...cell, ambiguous_canonical: 2 }]],
    ambiguousKeys: [ambiguousKey, ambiguousKey],
  };
  assert.throws(
    () => assertState(tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_AMBIGUOUS_KEY_INVALID:/,
  );
});