import assert from "node:assert/strict";
import test from "node:test";
import {
  N2_TRIFECTA_CANARY_MAX_RACES,
  N2_TRIFECTA_SELECTION_COUNT,
  auditN2TrifectaMarketSnapshot,
  buildCanonicalTrifectaSelectionSpace,
  buildN2TrifectaMarketFoundation,
  type N2TrifectaMarketSnapshotCandidate,
  type N2TrifectaMarketSourceInventory,
} from "./n2TrifectaMarketFoundation";

function inventory(overrides: Partial<N2TrifectaMarketSourceInventory> = {}): N2TrifectaMarketSourceInventory {
  return {
    readerVersion: "fixture-reader-v1",
    cohort: { dateFrom: "2026-08-01", dateTo: "2026-08-07", dayCount: 7 },
    sourceTable: "trifecta_market_raw_snapshots",
    sourceTablePresent: true,
    columns: [
      "available_at",
      "bet_selection",
      "bet_type",
      "captured_at",
      "checkpoint_label",
      "decision_cutoff",
      "odds",
      "parse_run_id",
      "race_id",
      "raw_document_id",
      "raw_payload",
      "raw_payload_digest",
      "source_url",
    ],
    totalRows: 2400,
    raceCount: 20,
    checkpointCount: 20,
    completeSnapshotCount: 20,
    rawDocumentIdColumnPresent: true,
    rawPayloadColumnPresent: true,
    rawPayloadDigestColumnPresent: true,
    parseRunIdColumnPresent: true,
    sourceUrlColumnPresent: true,
    capturedAtColumnPresent: true,
    availableAtColumnPresent: true,
    decisionCutoffColumnPresent: true,
    checkpointLabelColumnPresent: true,
    ...overrides,
  };
}

function candidate(id = 1, overrides: Partial<N2TrifectaMarketSnapshotCandidate> = {}): N2TrifectaMarketSnapshotCandidate {
  const race = String(id).padStart(2, "0");
  return {
    raceId: `20260806-05-${race}`,
    checkpointLabel: "T-10",
    availableAt: "2026-08-06T03:49:00.000Z",
    capturedAt: "2026-08-06T03:50:00.000Z",
    decisionCutoff: "2026-08-06T04:00:00.000Z",
    rawDocumentId: `raw-doc-${race}`,
    rawPayloadDigest: "a".repeat(64),
    parseRunId: `parse-${race}`,
    sourceUrl: "https://example.invalid/official-market",
    proposedObservationId: `obs-${race}`,
    odds: buildCanonicalTrifectaSelectionSpace().map((selection, index) => ({ selection, odds: index + 1.5 })),
    ...overrides,
  };
}

test("canonical trifecta selection space is exactly the 120 ordered permutations", () => {
  const selections = buildCanonicalTrifectaSelectionSpace();
  assert.equal(selections.length, N2_TRIFECTA_SELECTION_COUNT);
  assert.equal(new Set(selections).size, N2_TRIFECTA_SELECTION_COUNT);
  assert.ok(selections.includes("123"));
  assert.ok(selections.includes("654"));
  assert.ok(!selections.includes("112"));
  assert.ok(!selections.includes("1234"));
});

test("a complete, atomic-PIT, lineaged snapshot passes", () => {
  const audit = auditN2TrifectaMarketSnapshot(candidate());
  assert.equal(audit.status, "PASS");
  assert.deepEqual(audit.blockers, []);
  assert.equal(audit.payload.rowCount, 120);
  assert.equal(audit.payload.distinctSelectionCount, 120);
  assert.equal(audit.pit.status, "PASS");
  assert.equal(audit.lineage.status, "PASS");
  assert.match(audit.checkpointIdentity ?? "", /^[0-9a-f]{64}$/);
  assert.match(audit.idempotencyKey ?? "", /^[0-9a-f]{64}$/);
});

test("incomplete payload, duplicate selection, bad odds, and PIT inversion fail closed", () => {
  const odds = candidate().odds.slice(0, 119);
  odds.push({ selection: odds[0].selection, odds: 0 });
  const audit = auditN2TrifectaMarketSnapshot(candidate(1, {
    odds,
    availableAt: "2026-08-06T03:51:00.000Z",
    capturedAt: "2026-08-06T03:50:00.000Z",
  }));
  assert.equal(audit.status, "BLOCKED");
  assert.ok(audit.blockers.includes("AVAILABLE_AFTER_CAPTURE"));
  assert.ok(audit.blockers.includes("DISTINCT_SELECTION_COUNT_NOT_120"));
  assert.ok(audit.blockers.includes("SELECTION_SPACE_INCOMPLETE"));
  assert.ok(audit.blockers.includes("DUPLICATE_SELECTION"));
  assert.ok(audit.blockers.includes("NON_POSITIVE_OR_NON_FINITE_ODDS"));
});

test("missing raw lineage prevents idempotency resolution", () => {
  const audit = auditN2TrifectaMarketSnapshot(candidate(1, {
    rawDocumentId: "",
    rawPayloadDigest: "not-a-digest",
    parseRunId: "",
    proposedObservationId: "",
  }));
  assert.equal(audit.status, "BLOCKED");
  assert.equal(audit.lineage.status, "BLOCKED");
  assert.equal(audit.checkpointIdentity, null);
  assert.equal(audit.idempotencyKey, null);
});

test("foundation emits a bounded, deterministic, write-disabled review manifest", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => candidate(index + 1));
  const first = buildN2TrifectaMarketFoundation({ inventory: inventory(), candidates, requestedMaxRaces: 20 });
  const second = buildN2TrifectaMarketFoundation({ inventory: inventory(), candidates: [...candidates].reverse(), requestedMaxRaces: 20 });

  assert.equal(first.status, "READY_FOR_HUMAN_REVIEW");
  assert.equal(first.writeAuthorized, false);
  assert.equal(first.autoCreateApproval, false);
  assert.equal(first.productionApplyExecuted, false);
  assert.equal(first.canaryManifest.entryCount, N2_TRIFECTA_CANARY_MAX_RACES);
  assert.equal(first.canaryManifest.writeAuthorized, false);
  assert.equal(first.canaryManifest.productionApplyExecuted, false);
  assert.equal(first.canaryManifest.manifestDigest, second.canaryManifest.manifestDigest);
  assert.equal(first.reviewBundleDigest, second.reviewBundleDigest);
  assert.deepEqual(first.canaryManifest.entries.map((entry) => entry.raceId),
    second.canaryManifest.entries.map((entry) => entry.raceId));
});

test("raw-lineage inventory gaps block the whole canary even with safe fixture snapshots", () => {
  const summary = buildN2TrifectaMarketFoundation({
    inventory: inventory({ rawPayloadColumnPresent: false, rawPayloadDigestColumnPresent: false }),
    candidates: [candidate()],
  });
  assert.equal(summary.status, "BLOCKED_NOT_READY_FOR_CANARY");
  assert.equal(summary.canaryManifest.entryCount, 0);
  assert.ok(summary.inventoryBlockers.includes("RAW_PAYLOAD_COLUMN_MISSING"));
  assert.ok(summary.inventoryBlockers.includes("RAW_PAYLOAD_DIGEST_COLUMN_MISSING"));
});

test("duplicate checkpoint identity blocks the entire review bundle", () => {
  const same = candidate();
  const summary = buildN2TrifectaMarketFoundation({ inventory: inventory(), candidates: [same, { ...same }] });
  assert.equal(summary.status, "BLOCKED_NOT_READY_FOR_CANARY");
  assert.equal(summary.duplicateCheckpointIdentities.length, 1);
  assert.equal(summary.canaryManifest.entryCount, 0);
});

test("canary bound cannot exceed twenty races", () => {
  assert.throws(
    () => buildN2TrifectaMarketFoundation({ inventory: inventory(), candidates: [candidate()], requestedMaxRaces: 21 }),
    /requestedMaxRaces must be 1\.\.20/,
  );
});
