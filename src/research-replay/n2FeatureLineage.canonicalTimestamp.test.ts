import assert from "node:assert/strict";
import test from "node:test";
import {
  verifyN2FeatureLineage,
  type N2FeatureLineageEvidenceRow,
} from "./n2FeatureLineage";

const EXPECTED = {
  canonicalRaceKey: "2026-05-20:01:01",
  observationId: "obs-1",
  rawDocumentId: "raw-1",
  allowedObservationTypes: ["official_program"],
} as const;

function evidence(overrides: Partial<N2FeatureLineageEvidenceRow> = {}): N2FeatureLineageEvidenceRow {
  return {
    observationId: "obs-1",
    canonicalRaceKey: "2026-05-20:01:01",
    observationType: "official_program",
    observationRawDocumentId: "raw-1",
    sourcePublishedAt: "2026-05-20T03:58:00.000Z",
    sourceObservedAt: "2026-05-20T03:59:00.000Z",
    firstSeenAt: "2026-05-20T04:00:00.000Z",
    timingQuality: "source_exact",
    sourceQuality: "official_public",
    parseRawDocumentId: "raw-1",
    parseStatus: "success",
    rawDocumentId: "raw-1",
    integrityStatus: "verified",
    securityScanStatus: "passed",
    parserReplayEligible: 1,
    ...overrides,
  };
}

test("lineage rejects normalized or noncanonical observed timestamps", () => {
  for (const sourceObservedAt of [
    "2026-05-20T24:00:00.000Z",
    "2026-05-20T03:59:00+00:00",
    "2026-05-20T03:59:00Z",
  ]) {
    assert.deepEqual(
      verifyN2FeatureLineage(EXPECTED, evidence({ sourceObservedAt })),
      { status: "excluded", reason: "excluded_lineage_unknown_timestamp" },
      sourceObservedAt,
    );
  }
});

test("lineage rejects noncanonical exact publication timestamps", () => {
  for (const sourcePublishedAt of [
    "2026-05-20T24:00:00.000Z",
    "2026-05-20T03:58:00+00:00",
  ]) {
    assert.deepEqual(
      verifyN2FeatureLineage(EXPECTED, evidence({ sourcePublishedAt })),
      { status: "excluded", reason: "excluded_lineage_unknown_timestamp" },
      sourcePublishedAt,
    );
  }
});

test("lineage keeps canonical UTC instants eligible", () => {
  assert.equal(verifyN2FeatureLineage(EXPECTED, evidence()).status, "verified");
});
