import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalTrifectaSelectionSpace,
  buildN2TrifectaCheckpointIdentity,
  buildN2TrifectaMarketFoundation,
  type N2TrifectaMarketSnapshotCandidate,
  type N2TrifectaMarketSourceInventory,
} from "./n2TrifectaMarketFoundation";

function inventory(): N2TrifectaMarketSourceInventory {
  return {
    readerVersion: "fixture-reader-v1",
    cohort: { dateFrom: "2026-08-01", dateTo: "2026-08-07", dayCount: 7 },
    sourceTable: "trifecta_market_raw_snapshots",
    sourceTablePresent: true,
    columns: [
      "available_at",
      "captured_at",
      "checkpoint_label",
      "decision_cutoff",
      "parse_run_id",
      "race_id",
      "raw_document_id",
      "raw_payload",
      "raw_payload_digest",
    ],
    totalRows: 120,
    raceCount: 1,
    checkpointCount: 1,
    completeSnapshotCount: 1,
    rawDocumentIdColumnPresent: true,
    rawPayloadColumnPresent: true,
    rawPayloadDigestColumnPresent: true,
    parseRunIdColumnPresent: true,
    sourceUrlColumnPresent: false,
    capturedAtColumnPresent: true,
    availableAtColumnPresent: true,
    decisionCutoffColumnPresent: true,
    checkpointLabelColumnPresent: true,
  };
}

function candidate(capturedAt: string): N2TrifectaMarketSnapshotCandidate {
  return {
    raceId: "20260806-05-01",
    checkpointLabel: "T-10",
    availableAt: "2026-08-06T03:49:00.000Z",
    capturedAt,
    decisionCutoff: "2026-08-06T04:00:00.000Z",
    rawDocumentId: "raw-doc-01",
    rawPayloadDigest: "a".repeat(64),
    parseRunId: "parse-01",
    sourceUrl: null,
    proposedObservationId: "obs-01",
    odds: buildCanonicalTrifectaSelectionSpace().map((selection, index) => ({ selection, odds: index + 1.5 })),
  };
}

test("checkpoint identity canonicalizes equivalent explicit-zone instants", () => {
  const utc = candidate("2026-08-06T03:50:00.000Z");
  const offset = candidate("2026-08-06T12:50:00.000+09:00");

  assert.equal(buildN2TrifectaCheckpointIdentity(utc), buildN2TrifectaCheckpointIdentity(offset));
});

test("equivalent checkpoint instants are treated as duplicate review identities", () => {
  const summary = buildN2TrifectaMarketFoundation({
    inventory: inventory(),
    candidates: [
      candidate("2026-08-06T03:50:00.000Z"),
      candidate("2026-08-06T12:50:00.000+09:00"),
    ],
  });

  assert.equal(summary.status, "BLOCKED_NOT_READY_FOR_CANARY");
  assert.equal(summary.duplicateCheckpointIdentities.length, 1);
  assert.equal(summary.canaryManifest.entryCount, 0);
});
