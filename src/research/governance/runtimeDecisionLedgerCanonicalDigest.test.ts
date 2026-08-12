import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
  runtimeDecisionLedgerDigest,
  validateRuntimeDecisionLedgerRecord,
  type RuntimeDecisionLedgerRecord,
} from "./runtimeDecisionLedger";

function record(sourceRowDigest = "a".repeat(64)): RuntimeDecisionLedgerRecord {
  return {
    schemaVersion: RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
    recordId: "runtime-decision:test:decision-1",
    decisionId: "decision-1",
    canonicalRaceId: "2026-08-05-08-08",
    sourceDecisionHistoryId: null,
    decisionSystem: "test",
    strategyVersion: "test-v1",
    modelVersion: "test-model-v1",
    featureVersion: "test-feature-v1",
    manifestId: "manifest-test",
    cohortId: "test-cohort",
    evaluationMode: "validation",
    ticketType: "trifecta",
    selection: "1-2-3",
    decision: "WATCH",
    decisionAt: "2026-08-05T05:26:30.000Z",
    oddsObservedAt: "2026-08-05T05:26:10.000Z",
    scheduledCloseAtSeen: "2026-08-05T05:32:00.000Z",
    currentOdds: 6.4,
    requiredOdds: 5.2,
    estimatedHitRate: 0.2,
    rawEstimatedHitRate: 0.2,
    expectedValue: 1.2,
    recommendedStakeYen: 0,
    sampleSize: 100,
    reasons: ["test"],
    warnings: [],
    dataCompleteness: "complete",
    notificationEligible: false,
    notificationDedupeKey: null,
    sourceRowDigest,
  };
}

test("Runtime Decision Ledger requires lowercase canonical SHA-256 source digests", () => {
  const canonical = record();
  assert.deepEqual(validateRuntimeDecisionLedgerRecord(canonical), { valid: true, errors: [] });

  const uppercase = record("A".repeat(64));
  const validation = validateRuntimeDecisionLedgerRecord(uppercase);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("sourceRowDigest must be a SHA-256 hex digest"));

  assert.notEqual(
    runtimeDecisionLedgerDigest(canonical),
    runtimeDecisionLedgerDigest(uppercase),
    "case-only source digest aliases would otherwise create distinct ledger identities",
  );
});
