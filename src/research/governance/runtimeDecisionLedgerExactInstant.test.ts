import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
  validateRuntimeDecisionLedgerRecord,
  type RuntimeDecisionLedgerRecord,
} from "./runtimeDecisionLedger";

function record(): RuntimeDecisionLedgerRecord {
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
    sourceRowDigest: "a".repeat(64),
  };
}

test("Runtime Decision Ledger rejects ambiguous and impossible temporal evidence", () => {
  for (const [field, value] of [
    ["decisionAt", "2026-08-05"],
    ["decisionAt", "2026-08-05T05:26:30"],
    ["decisionAt", "2026-02-30T05:26:30Z"],
    ["oddsObservedAt", "2026-08-05 05:26:10Z"],
    ["scheduledCloseAtSeen", "Wed, 05 Aug 2026 05:32:00 GMT"],
  ] as const) {
    const candidate = { ...record(), [field]: value };
    const result = validateRuntimeDecisionLedgerRecord(candidate);
    assert.equal(result.valid, false, `${field}=${value} must fail closed`);
    assert.ok(result.errors.includes(`${field} must be a valid timezone-bound ISO timestamp`));
  }
});

test("Runtime Decision Ledger accepts explicit UTC offsets as exact instants", () => {
  const candidate = record();
  candidate.oddsObservedAt = "2026-08-05T14:26:10+09:00";
  candidate.decisionAt = "2026-08-05T14:26:30+09:00";
  candidate.scheduledCloseAtSeen = "2026-08-05T14:32:00+09:00";
  assert.deepEqual(validateRuntimeDecisionLedgerRecord(candidate), { valid: true, errors: [] });
});
