import assert from "node:assert/strict";
import test from "node:test";
import { buildN2FeatureCoverageProfile, type N2FeatureCoverageEvent } from "./n2FeatureCoverage";

const EVENTS: N2FeatureCoverageEvent[] = [
  { canonicalRaceKey: "2004-01-01:01:01", sourceKind: "feature", key: "boat.1.nationalWinRate", status: "verified", observationId: "obs-1", rawDocumentId: "raw-1", availabilityBasis: "source_published_at" },
  { canonicalRaceKey: "2004-01-01:01:02", sourceKind: "feature", key: "boat.1.nationalWinRate", status: "excluded", exclusionReason: "excluded_lineage_not_found" },
  { canonicalRaceKey: "2026-05-20:01:01", sourceKind: "odds", key: "exacta:1-2", status: "verified", observationId: "obs-2", rawDocumentId: "raw-2", availabilityBasis: "source_observed_at" },
];

test("coverage: groups exact denominators by year and feature", () => {
  const profile = buildN2FeatureCoverageProfile({ inputKind: "fixture", events: EVENTS });
  assert.equal(profile.dataStatus, "FIXTURE_ONLY");
  assert.equal(profile.totalEvents, 3);
  assert.equal(profile.totalRaces, 3);
  assert.deepEqual(profile.overall, {
    key: "all", expected: 3, verified: 2, excluded: 1, coveragePct: 66.6667,
    provenanceComplete: 2, uniqueObservationCount: 2, uniqueRawDocumentCount: 2,
    availabilityBasisCounts: { source_observed_at: 1, source_published_at: 1 },
    exclusionReasons: { excluded_lineage_not_found: 1 },
  });
  assert.deepEqual(profile.byYear.map((x) => [x.key, x.expected, x.verified]), [["2004", 2, 1], ["2026", 1, 1]]);
  assert.deepEqual(profile.byFeature.map((x) => [x.key, x.coveragePct]), [
    ["feature:boat.1.nationalWinRate", 50], ["odds:exacta:1-2", 100],
  ]);
});

test("coverage: digest is deterministic across input order", () => {
  const a = buildN2FeatureCoverageProfile({ inputKind: "fixture", events: EVENTS });
  const b = buildN2FeatureCoverageProfile({ inputKind: "fixture", events: [...EVENTS].reverse() });
  assert.equal(a.digest, b.digest);
  assert.deepEqual(a, b);
});

test("coverage: empty real input is pending, never a successful zero-coverage report", () => {
  const profile = buildN2FeatureCoverageProfile({ inputKind: "real", events: [] });
  assert.equal(profile.dataStatus, "PENDING_REAL_DATA");
  assert.equal(profile.totalEvents, 0);
});

test("coverage: duplicate race/source/key denominator fails closed", () => {
  assert.throws(() => buildN2FeatureCoverageProfile({ inputKind: "fixture", events: [EVENTS[0], EVENTS[0]] }),
    /N2_COVERAGE_DUPLICATE_EVENT/);
});

test("coverage: verified event requires complete immutable provenance", () => {
  assert.throws(() => buildN2FeatureCoverageProfile({ inputKind: "fixture", events: [{
    canonicalRaceKey: "2026-05-20:01:01", sourceKind: "feature", key: "x", status: "verified",
  }] }), /N2_COVERAGE_INVALID_VERIFIED_EVENT/);
});

test("coverage: invalid canonical race key and ambiguous excluded event are rejected", () => {
  assert.throws(() => buildN2FeatureCoverageProfile({ inputKind: "fixture", events: [{
    canonicalRaceKey: "bad", sourceKind: "feature", key: "x", status: "excluded", exclusionReason: "missing",
  }] }), /N2_COVERAGE_INVALID_RACE_KEY/);
  assert.throws(() => buildN2FeatureCoverageProfile({ inputKind: "fixture", events: [{
    canonicalRaceKey: "2026-02-30:01:01", sourceKind: "feature", key: "x", status: "excluded", exclusionReason: "missing",
  }] }), /N2_COVERAGE_INVALID_RACE_KEY/);
  assert.throws(() => buildN2FeatureCoverageProfile({ inputKind: "fixture", events: [{
    canonicalRaceKey: "2026-05-20:01:01", sourceKind: "feature", key: "x", status: "excluded",
    exclusionReason: "missing", observationId: "should-not-exist",
  }] }), /N2_COVERAGE_INVALID_EXCLUDED_EVENT/);
});
