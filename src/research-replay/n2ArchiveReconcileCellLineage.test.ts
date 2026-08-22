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

const baseState = {
  version: RECONCILE_INPUT_VERSION,
  cells: [] as Array<[string, typeof emptyCell]>,
  paired: [] as Array<[string, number]>,
  statusMatrix: [] as Array<[string, number]>,
  samples: [],
  processedFiles: ["k260730.lzh"],
  parseErrors: [] as Array<{ file: string; error: string }>,
  ambiguousKeys: [],
};

function assertStateRejects(state: typeof baseState): void {
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, state);
  assert.throws(
    () => assertArchiveReconcileCheckpointStateDigest(digest, contract, state),
    /ARCHIVE_RECONCILE_CHECKPOINT_CELL_KEY_INVALID/,
  );
}

test("archive reconcile resume accepts producer cell lineage", () => {
  const key = "2026\u0000trifecta\u0000Toda";
  const state = {
    ...baseState,
    cells: [[key, { ...emptyCell, exact_match: 1 }]] as Array<[string, typeof emptyCell]>,
    paired: [[key, 1]] as Array<[string, number]>,
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, state);
  assert.doesNotThrow(() => assertArchiveReconcileCheckpointStateDigest(digest, contract, state));
});

test("archive reconcile resume rejects rehashed cell rollup lineage drift", () => {
  for (const key of [
    "2025\u0000trifecta\u0000Toda",
    "2026\u0000trifecta\u0000FakeVenue",
    "2026\u0000fake\u0000Toda",
    "2026\u0000-\u0000Toda",
  ]) {
    const state = {
      ...baseState,
      cells: [[key, { ...emptyCell, exact_match: 1 }]] as Array<[string, typeof emptyCell]>,
      paired: [[key, 1]] as Array<[string, number]>,
    };
    assertStateRejects(state);
  }
});

test("archive reconcile resume requires parse failures to use the producer sentinel cell", () => {
  const invalid = {
    ...baseState,
    cells: [["2026\u0000trifecta\u0000Toda", { ...emptyCell, parse_failure: 1 }]] as Array<[string, typeof emptyCell]>,
    parseErrors: [{ file: "k260730.lzh", error: "synthetic parse failure" }],
  };
  assertStateRejects(invalid);

  const valid = {
    ...baseState,
    cells: [["2026\u0000-\u0000-", { ...emptyCell, parse_failure: 1 }]] as Array<[string, typeof emptyCell]>,
    parseErrors: [{ file: "k260730.lzh", error: "synthetic parse failure" }],
  };
  const digest = buildArchiveReconcileCheckpointStateDigest(contract, valid);
  assert.doesNotThrow(() => assertArchiveReconcileCheckpointStateDigest(digest, contract, valid));
});
