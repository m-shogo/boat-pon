import assert from "node:assert/strict";
import test from "node:test";
import { verifyN2FeatureLineage, type N2FeatureLineageEvidenceRow } from "./n2FeatureLineage";

const EXPECTED = {
  canonicalRaceKey: "2026-05-20:01:01",
  observationId: "obs-1",
  rawDocumentId: "raw-1",
  allowedObservationTypes: ["official_program"],
} as const;

function evidence(over: Partial<N2FeatureLineageEvidenceRow> = {}): N2FeatureLineageEvidenceRow {
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
    ...over,
  };
}

test("lineage: impossible calendar dates fail closed for every timestamp role", () => {
  for (const over of [
    { sourcePublishedAt: "2026-02-30T03:58:00.000Z" },
    { sourceObservedAt: "2026-04-31T03:59:00.000Z" },
    { firstSeenAt: "2026-02-29T04:00:00.000Z" },
  ] satisfies Partial<N2FeatureLineageEvidenceRow>[]) {
    assert.deepEqual(
      verifyN2FeatureLineage(EXPECTED, evidence(over)),
      { status: "excluded", reason: "excluded_lineage_unknown_timestamp" },
    );
  }
});

test("lineage: a real leap day remains valid", () => {
  const result = verifyN2FeatureLineage(EXPECTED, evidence({
    sourcePublishedAt: "2028-02-29T03:58:00.000Z",
    sourceObservedAt: "2028-02-29T03:59:00.000Z",
    firstSeenAt: "2028-02-29T04:00:00.000Z",
  }));
  assert.equal(result.status, "verified");
});
