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
  selectedFileBasenames: ["k251231.lzh", "k260101.lzh"],
  sourceSidecarSha256: "b".repeat(64),
};

const parseFailureCell = {
  exact_match: 0,
  status_mismatch: 0,
  result_kind_mismatch: 0,
  archive_only: 0,
  canonical_only: 0,
  ambiguous_canonical: 0,
  parse_failure: 1,
  falseRefund: 0,
};

const state = {
  version: RECONCILE_INPUT_VERSION,
  cells: [["2026\u0000-\u0000-", parseFailureCell]],
  paired: [],
  statusMatrix: [],
  samples: [],
  processedFiles: ["k251231.lzh", "k260101.lzh"],
  parseErrors: [{ file: "k260101.lzh", error: "synthetic parse failure" }],
  ambiguousKeys: [],
};

function assertState(candidate: unknown): void {
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, candidate);
  assertArchiveReconcileCheckpointStateDigest(digest, contract, candidate);
}

test("archive reconcile resume accepts producer-consistent parse-error cell lineage", () => {
  assert.doesNotThrow(() => assertState(state));
});

test("archive reconcile resume rejects rehashed parse-error year relocation", () => {
  const tampered = {
    ...state,
    cells: [["2025\u0000-\u0000-", parseFailureCell]],
  };
  assert.throws(
    () => assertState(tampered),
    /ARCHIVE_RECONCILE_CHECKPOINT_PARSE_ERROR_CELL_MISMATCH:/,
  );
});