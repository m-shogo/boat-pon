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

const correction = {
  raceKey: "2026-08-01:01:R1",
  betType: "trifecta",
  action: "special_payout_addition",
  originalStatus: null,
  correctedStatus: "settled",
  originalResultKind: null,
  correctedResultKind: "special_payout",
  defectCode: "V1_SPECIAL_PAYOUT_FALSE_REFUND",
};

const baseState = {
  version: "n2-settlement-reparse-v1",
  counts: {
    files_scanned: 1,
    files_ingested: 1,
    files_not_ingested: 0,
    files_duplicate_source: 0,
    parse_errors: 0,
    appended_candidates: 401,
    appended_parse_runs: 1,
    appended_observations: 1,
    supersession_relations: 0,
    ambiguous_active: 0,
    fr_from_refunded: 0,
    fr_from_partial: 0,
    exact: 0,
    false_refund_correction: 0,
    result_kind_correction: 0,
    special_payout_addition: 401,
    ambiguous_non_defect: 0,
    unexpected_addition: 0,
  },
  corrections: Array.from({ length: 400 }, () => ({ ...correction })),
  processedFiles: ["k260801.lzh"],
  processedRawDocs: ["raw-1"],
  byYear: [["2026", { false_refund: 0, result_kind: 0, special_addition: 401 }]],
  byBetType: [["trifecta", { false_refund: 0, result_kind: 0, special_addition: 401 }]],
};

function validate(state: typeof baseState): void {
  const digest = buildN2SettlementReparseCheckpointStateDigest(identity, state);
  assertN2SettlementReparseCheckpointStateDigest(digest, identity, state);
}

test("reparse checkpoint accepts residual aggregate evidence on canonical keys after the 400-sample cap", () => {
  assert.doesNotThrow(() => validate(baseState));
});

test("reparse checkpoint rejects a rehashed residual year outside processed archive lineage", () => {
  const tampered = {
    ...baseState,
    byYear: [
      ["2026", { false_refund: 0, result_kind: 0, special_addition: 400 }],
      ["2025", { false_refund: 0, result_kind: 0, special_addition: 1 }],
    ],
  } as typeof baseState;
  assert.throws(
    () => validate(tampered),
    /REPARSE_CHECKPOINT_REPORT_KEY_INVALID:byYear:2025/,
  );
});

test("reparse checkpoint rejects a rehashed residual unsupported bet type after the sample cap", () => {
  const tampered = {
    ...baseState,
    byBetType: [
      ["trifecta", { false_refund: 0, result_kind: 0, special_addition: 400 }],
      ["fake", { false_refund: 0, result_kind: 0, special_addition: 1 }],
    ],
  } as typeof baseState;
  assert.throws(
    () => validate(tampered),
    /REPARSE_CHECKPOINT_REPORT_KEY_INVALID:byBetType:fake/,
  );
});
