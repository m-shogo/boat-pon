import assert from "node:assert/strict";
import test from "node:test";
import {
  N2_PIT_AUDIT_VERSION,
  auditN2PitObservation,
  buildN2PitAuditSummary,
  type N2PitAuditObservation,
} from "./n2PitAudit";

function row(overrides: Partial<N2PitAuditObservation> = {}): N2PitAuditObservation {
  return {
    observationId: "obs-program-1",
    canonicalRaceKey: "2024-06-01:01:R1",
    observationType: "official_program",
    observationRawDocumentId: "raw-1",
    sourcePublishedAt: "2024-06-01T00:00:00.000Z",
    sourceObservedAt: "2024-06-01T00:01:00.000Z",
    firstSeenAt: "2024-06-01T00:02:00.000Z",
    timingQuality: "source_exact",
    sourceQuality: "official_public",
    parseRawDocumentId: "raw-1",
    parseStatus: "success",
    rawDocumentId: "raw-1",
    integrityStatus: "verified",
    securityScanStatus: "passed",
    parserReplayEligible: 1,
    decisionCutoff: "2024-06-01T01:00:00.000Z",
    ...overrides,
  };
}

test("safe official program observation passes PIT", () => {
  const result = auditN2PitObservation(row());
  assert.deepEqual(result, {
    observationType: "official_program",
    reasonClass: "safe",
    reason: "pit_safe",
    usable: true,
  });
});

test("official program published after cutoff is future leakage", () => {
  const result = auditN2PitObservation(row({
    sourcePublishedAt: "2024-06-01T01:00:00.001Z",
    sourceObservedAt: "2024-06-01T01:00:01.000Z",
    firstSeenAt: "2024-06-01T01:00:02.000Z",
  }));
  assert.equal(result.usable, false);
  assert.equal(result.reasonClass, "future_leakage");
  assert.equal(result.reason, "excluded_pit_after_cutoff");
});

test("safe live market checkpoint passes all timing constraints", () => {
  const result = auditN2PitObservation(row({
    observationId: "obs-market-1",
    observationType: "trifecta_market",
    sourcePublishedAt: null,
    sourceObservedAt: "2024-06-01T00:55:00.000Z",
    firstSeenAt: "2024-06-01T00:55:01.000Z",
    timingQuality: "observed_only",
  }));
  assert.equal(result.usable, true);
  assert.equal(result.reasonClass, "safe");
  assert.equal(result.reason, "odds_safe");
});

test("market capture after cutoff is future leakage", () => {
  const result = auditN2PitObservation(row({
    observationId: "obs-market-1",
    observationType: "trifecta_market",
    sourcePublishedAt: null,
    sourceObservedAt: "2024-06-01T01:00:00.001Z",
    firstSeenAt: "2024-06-01T01:00:01.000Z",
    timingQuality: "observed_only",
  }));
  assert.equal(result.usable, false);
  assert.equal(result.reasonClass, "future_leakage");
  assert.equal(result.reason, "excluded_odds_capture_after_cutoff");
});

test("ambiguous lineage timing fails closed", () => {
  const result = auditN2PitObservation(row({ timingQuality: "ambiguous" }));
  assert.equal(result.usable, false);
  assert.equal(result.reasonClass, "ambiguous_timing");
  assert.equal(result.reason, "excluded_lineage_ambiguous_timing");
});

test("missing decision cutoff fails closed before lineage use", () => {
  const result = auditN2PitObservation(row({ decisionCutoff: null }));
  assert.equal(result.usable, false);
  assert.equal(result.reasonClass, "ambiguous_timing");
  assert.equal(result.reason, "decision_cutoff_missing_or_invalid");
});

test("post-race result source is same-race leakage", () => {
  const result = auditN2PitObservation(row({ observationType: "official_result" }));
  assert.equal(result.usable, false);
  assert.equal(result.reasonClass, "same_race_leakage");
  assert.equal(result.reason, "same_race_post_race_source_used_as_feature");
});

test("unknown feature source is excluded without being mislabeled as same-race", () => {
  const result = auditN2PitObservation(row({ observationType: "current_racer_profile" }));
  assert.equal(result.usable, false);
  assert.equal(result.reasonClass, "source_not_allowed");
  assert.equal(result.reason, "feature_source_type_not_allowlisted");
});

test("lineage raw-chain mismatch is a lineage exclusion", () => {
  const result = auditN2PitObservation(row({ parseRawDocumentId: "raw-other" }));
  assert.equal(result.usable, false);
  assert.equal(result.reasonClass, "lineage_exclusion");
  assert.equal(result.reason, "excluded_lineage_raw_chain_mismatch");
});

test("clean real observations produce deterministic PASS summary", () => {
  const observations = [
    row(),
    row({
      observationId: "obs-market-1",
      observationType: "trifecta_market",
      sourcePublishedAt: null,
      sourceObservedAt: "2024-06-01T00:55:00.000Z",
      firstSeenAt: "2024-06-01T00:55:01.000Z",
      timingQuality: "observed_only",
    }),
  ];
  const first = buildN2PitAuditSummary(observations);
  const second = buildN2PitAuditSummary([...observations].reverse());
  assert.equal(first.auditVersion, N2_PIT_AUDIT_VERSION);
  assert.equal(first.status, "PASS");
  assert.equal(first.dataStatus, "REAL_DATA");
  assert.equal(first.auditedObservationCount, 2);
  assert.equal(first.verifiedSafeCount, 2);
  assert.equal(first.sameRaceViolationCount, 0);
  assert.equal(first.futureViolationCount, 0);
  assert.equal(first.ambiguousTimingCount, 0);
  assert.equal(first.outputDigest, second.outputDigest);
  assert.equal(first.inputDigest, second.inputDigest);
});

test("no real events is CONDITIONAL rather than a fabricated zero-coverage PASS", () => {
  const summary = buildN2PitAuditSummary([]);
  assert.equal(summary.status, "CONDITIONAL");
  assert.equal(summary.dataStatus, "PENDING_REAL_DATA");
  assert.equal(summary.auditedObservationCount, 0);
  assert.equal(summary.postRaceFeatureRead, false);
});

test("ambiguous or lineage-excluded evidence is CONDITIONAL", () => {
  const summary = buildN2PitAuditSummary([
    row({ timingQuality: "unknown" }),
    row({ observationId: "obs-program-2", parseStatus: "warning" }),
  ]);
  assert.equal(summary.status, "CONDITIONAL");
  assert.equal(summary.verifiedSafeCount, 0);
  assert.equal(summary.excludedCount, 2);
  assert.equal(summary.ambiguousTimingCount, 1);
  assert.deepEqual(summary.reasonClassCounts, {
    safe: 0,
    same_race_leakage: 0,
    future_leakage: 0,
    ambiguous_timing: 1,
    lineage_exclusion: 1,
    source_not_allowed: 0,
  });
});

test("future or same-race leakage makes the audit FAILED", () => {
  const summary = buildN2PitAuditSummary([
    row({
      sourcePublishedAt: "2024-06-01T01:00:00.001Z",
      sourceObservedAt: "2024-06-01T01:00:01.000Z",
      firstSeenAt: "2024-06-01T01:00:02.000Z",
    }),
    row({ observationId: "obs-result-1", observationType: "settlement" }),
  ]);
  assert.equal(summary.status, "FAILED");
  assert.equal(summary.futureViolationCount, 1);
  assert.equal(summary.sameRaceViolationCount, 1);
  assert.equal(summary.postRaceFeatureRead, true);
});
