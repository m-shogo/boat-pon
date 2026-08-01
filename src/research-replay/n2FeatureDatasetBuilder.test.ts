import assert from "node:assert/strict";
import test from "node:test";
import { enumerateBetSelections } from "./n2DatasetContract";
import { buildN2FeatureDatasetRows, type N2FeatureDatasetBuildInput } from "./n2FeatureDatasetBuilder";

const CUTOFF = "2026-05-20T05:00:00.000Z";

function base(over: Partial<N2FeatureDatasetBuildInput> = {}): N2FeatureDatasetBuildInput {
  return {
    canonicalRaceKey: "2026-05-20:01:01",
    betType: "exacta",
    decisionCutoff: CUTOFF,
    mode: "historical",
    eligibility: { eligible: true, reason: "eligible" },
    winningSelections: ["1-2"],
    payoutYenBySelection: { "1-2": 500 },
    features: [{
      featureKey: "nationalWinRate",
      value: 7.1,
      pitClass: "historical_safe",
      availableAt: "2026-05-20T04:00:00.000Z",
      observationId: "obs-feature-1",
      rawDocumentId: "raw-feature-1",
    }],
    odds: [],
    requireOdds: false,
    ...over,
  };
}

test("builder: emits every exacta selection with label, feature and provenance", () => {
  const result = buildN2FeatureDatasetRows(base());
  assert.equal(result.status, "built");
  assert.equal(result.rows.length, 30);
  assert.equal(result.rows.filter((row) => row.label.outcome === "hit").length, 1);
  assert.equal(result.rows[0].features.nationalWinRate, 7.1);
  assert.equal(result.rows[0].featureProvenance[0].rawDocumentId, "raw-feature-1");
  assert.equal(result.rows[0].odds, null);
});

test("builder: known live-only key cannot be laundered as historical_safe", () => {
  const result = buildN2FeatureDatasetRows(base({ features: [{
    featureKey: "courseAvgSt",
    value: 0.14,
    pitClass: "historical_safe",
    availableAt: "2026-05-20T04:00:00.000Z",
    observationId: "obs-leak",
    rawDocumentId: "raw-leak",
  }] }));
  assert.deepEqual(result.exclusions, [{ scope: "feature", key: "courseAvgSt", reason: "excluded_feature_class_mismatch" }]);
  assert.equal(result.rows.length, 0);
});

test("builder: future feature excludes the entire candidate rather than silently dropping it", () => {
  const result = buildN2FeatureDatasetRows(base({ features: [{
    featureKey: "nationalWinRate",
    value: 7.1,
    pitClass: "historical_safe",
    availableAt: "2026-05-20T05:00:00.001Z",
    observationId: "obs-future",
    rawDocumentId: "raw-future",
  }] }));
  assert.equal(result.status, "excluded");
  assert.equal(result.exclusions[0].reason, "excluded_pit_after_cutoff");
  assert.equal(result.rows.length, 0);
});

test("builder: post-cutoff odds is rejected through the atomic guard", () => {
  const result = buildN2FeatureDatasetRows(base({ odds: [{
    betSelection: "1-2",
    odds: 5.2,
    kind: "live_checkpoint",
    capturedAt: "2026-05-20T05:00:00.001Z",
    availableAt: "2026-05-20T04:59:59.000Z",
    observationId: "obs-odds",
    rawDocumentId: "raw-odds",
  }] }));
  assert.equal(result.status, "excluded");
  assert.equal(result.exclusions[0].reason, "excluded_odds_capture_after_cutoff");
});

test("builder: required odds must cover all canonical selections", () => {
  const odds = enumerateBetSelections("exacta").slice(0, 29).map((betSelection, index) => ({
    betSelection,
    odds: index + 1,
    kind: "live_checkpoint" as const,
    capturedAt: "2026-05-20T04:59:30.000Z",
    availableAt: "2026-05-20T04:59:00.000Z",
    observationId: `obs-odds-${index}`,
    rawDocumentId: "raw-odds",
  }));
  const result = buildN2FeatureDatasetRows(base({ odds, requireOdds: true }));
  assert.equal(result.status, "excluded");
  assert.equal(result.exclusions[0].reason, "excluded_missing_required_odds");
  assert.equal(result.rows.length, 0);
});

test("builder: noncanonical odds selection is rejected instead of ignored", () => {
  const result = buildN2FeatureDatasetRows(base({ odds: [{
    betSelection: "9-9",
    odds: 5.2,
    kind: "live_checkpoint",
    capturedAt: "2026-05-20T04:59:30.000Z",
    availableAt: "2026-05-20T04:59:00.000Z",
    observationId: "obs-odds-invalid",
    rawDocumentId: "raw-odds",
  }] }));
  assert.equal(result.status, "excluded");
  assert.equal(result.exclusions[0].reason, "excluded_noncanonical_odds_selection");
});

test("builder: ineligible settlement never emits training rows", () => {
  const result = buildN2FeatureDatasetRows(base({
    eligibility: { eligible: false, reason: "excluded_refunded" },
  }));
  assert.deepEqual(result.exclusions, [{
    scope: "candidate",
    key: "2026-05-20:01:01",
    reason: "excluded_refunded",
  }]);
  assert.equal(result.rows.length, 0);
});
