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
  sourceSidecarSha256: "b".repeat(64),
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
