import assert from "node:assert/strict";
import test from "node:test";
import { N2_FEATURE_LINEAGE_READONLY_SQL, verifyN2FeatureLineage, type N2FeatureLineageEvidenceRow } from "./n2FeatureLineage";

const EXPECTED = {
  canonicalRaceKey: "2026-05-20:01:01",
  observationId: "obs-1",
  rawDocumentId: "raw-1",
  allowedObservationTypes: ["official_program"],
} as const;

function evidence(over: Partial<N2FeatureLineageEvidenceRow> = {}): N2FeatureLineageEvidenceRow {
  return {
    observationId: "obs-1", canonicalRaceKey: "2026-05-20:01:01", observationType: "official_program",
    observationRawDocumentId: "raw-1", sourcePublishedAt: "2026-05-20T03:58:00.000Z",
    sourceObservedAt: "2026-05-20T03:59:00.000Z", firstSeenAt: "2026-05-20T04:00:00.000Z",
    timingQuality: "source_exact", sourceQuality: "official_public", parseRawDocumentId: "raw-1",
    parseStatus: "success", rawDocumentId: "raw-1", integrityStatus: "verified",
    securityScanStatus: "passed", parserReplayEligible: 1, ...over,
  };
}

test("lineage: read-only query joins observation, parse run and raw document", () => {
  assert.match(N2_FEATURE_LINEAGE_READONLY_SQL, /JOIN parse_runs/);
  assert.match(N2_FEATURE_LINEAGE_READONLY_SQL, /JOIN raw_documents/);
  assert.match(N2_FEATURE_LINEAGE_READONLY_SQL, /WHERE o\.observation_id = \? AND o\.raw_document_id = \?/);
});

test("lineage: exact published time produces verified immutable evidence", () => {
  const result = verifyN2FeatureLineage(EXPECTED, evidence());
  assert.deepEqual(result, { status: "verified", lineage: {
    contractVersion: "n2-feature-lineage-v1", sourceAvailableAt: "2026-05-20T03:58:00.000Z",
    sourceObservedAt: "2026-05-20T03:59:00.000Z",
    availabilityBasis: "source_published_at", observationId: "obs-1", rawDocumentId: "raw-1",
  } });
});

test("lineage: observed-only availability is conservative and explicit", () => {
  const result = verifyN2FeatureLineage(EXPECTED, evidence({ timingQuality: "observed_only", sourcePublishedAt: null }));
  assert.equal(result.status, "verified");
  if (result.status === "verified") {
    assert.equal(result.lineage.sourceAvailableAt, "2026-05-20T03:59:00.000Z");
    assert.equal(result.lineage.availabilityBasis, "source_observed_at");
  }
});

test("lineage: arbitrary IDs, cross-race and broken raw chain fail closed", () => {
  assert.equal(verifyN2FeatureLineage(EXPECTED, null).status, "excluded");
  assert.deepEqual(verifyN2FeatureLineage(EXPECTED, evidence({ canonicalRaceKey: "2026-05-20:01:02" })),
    { status: "excluded", reason: "excluded_lineage_race_mismatch" });
  assert.deepEqual(verifyN2FeatureLineage(EXPECTED, evidence({ parseRawDocumentId: "raw-other" })),
    { status: "excluded", reason: "excluded_lineage_raw_chain_mismatch" });
});

test("lineage: warning/quarantine/derived/ambiguous evidence cannot become training provenance", () => {
  assert.equal(verifyN2FeatureLineage(EXPECTED, evidence({ parseStatus: "warning" })).status, "excluded");
  assert.equal(verifyN2FeatureLineage(EXPECTED, evidence({ integrityStatus: "quarantined" })).status, "excluded");
  assert.equal(verifyN2FeatureLineage(EXPECTED, evidence({ sourceQuality: "derived_existing_row" })).status, "excluded");
  assert.equal(verifyN2FeatureLineage(EXPECTED, evidence({ timingQuality: "ambiguous" })).status, "excluded");
});

test("lineage: impossible timestamp order is rejected", () => {
  assert.deepEqual(verifyN2FeatureLineage(EXPECTED, evidence({
    sourcePublishedAt: "2026-05-20T04:00:00.001Z",
  })), { status: "excluded", reason: "excluded_lineage_timestamp_order" });
});
