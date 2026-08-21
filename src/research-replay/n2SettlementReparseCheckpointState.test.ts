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
  counts: { files_scanned: 1, files_ingested: 1 },
  corrections: [],
  processedFiles: ["k260801.lzh"],
  processedRawDocs: ["raw-1"],
  byYear: [["2026", { false_refund: 0, result_kind: 0, special_addition: 0 }]],
  byBetType: [],
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
