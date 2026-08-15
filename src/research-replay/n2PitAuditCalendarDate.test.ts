import assert from "node:assert/strict";
import test from "node:test";
import { auditN2PitObservation, type N2PitAuditObservation } from "./n2PitAudit";

function row(overrides: Partial<N2PitAuditObservation> = {}): N2PitAuditObservation {
  return {
    observationId: "obs-program-calendar",
    canonicalRaceKey: "2028-02-29:01:R1",
    observationType: "official_program",
    observationRawDocumentId: "raw-calendar",
    sourcePublishedAt: "2028-02-29T00:00:00.000Z",
    sourceObservedAt: "2028-02-29T00:01:00.000Z",
    firstSeenAt: "2028-02-29T00:02:00.000Z",
    timingQuality: "source_exact",
    sourceQuality: "official_public",
    parseRawDocumentId: "raw-calendar",
    parseStatus: "success",
    rawDocumentId: "raw-calendar",
    integrityStatus: "verified",
    securityScanStatus: "passed",
    parserReplayEligible: 1,
    decisionCutoff: "2028-02-29T01:00:00.000Z",
    ...overrides,
  };
}

test("PIT audit: impossible decision cutoff dates fail closed before lineage", () => {
  for (const decisionCutoff of [
    "2026-02-30T01:00:00.000Z",
    "2026-04-31T01:00:00+09:00",
    "2026-02-29T01:00:00.000Z",
  ]) {
    assert.deepEqual(auditN2PitObservation(row({ decisionCutoff })), {
      observationType: "official_program",
      reasonClass: "ambiguous_timing",
      reason: "decision_cutoff_missing_or_invalid",
      usable: false,
    });
  }
});

test("PIT audit: timezone-less decision cutoffs fail closed before lineage", () => {
  for (const decisionCutoff of [
    "2028-02-29",
    "2028-02-29T01:00:00",
    "2028-02-29 01:00:00Z",
  ]) {
    assert.deepEqual(auditN2PitObservation(row({ decisionCutoff })), {
      observationType: "official_program",
      reasonClass: "ambiguous_timing",
      reason: "decision_cutoff_missing_or_invalid",
      usable: false,
    });
  }
});

test("PIT audit: explicit timezone offsets remain valid", () => {
  assert.deepEqual(auditN2PitObservation(row({ decisionCutoff: "2028-02-29T10:00:00+09:00" })), {
    observationType: "official_program",
    reasonClass: "safe",
    reason: "pit_safe",
    usable: true,
  });
});

test("PIT audit: a real leap-day decision cutoff remains valid", () => {
  assert.deepEqual(auditN2PitObservation(row()), {
    observationType: "official_program",
    reasonClass: "safe",
    reason: "pit_safe",
    usable: true,
  });
});
