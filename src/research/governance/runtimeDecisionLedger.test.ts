import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
  runtimeDecisionLedgerDigest,
  validateRuntimeDecisionLedgerRecord,
  type RuntimeDecisionLedgerRecord,
} from "./runtimeDecisionLedger";

function validBuyRecord(): RuntimeDecisionLedgerRecord {
  return {
    schemaVersion: RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
    recordId: "runtime-decision:legacy_t5_formal:decision-20260805-08-08",
    decisionId: "decision-20260805-08-08",
    canonicalRaceId: "2026-08-05-08-08",
    sourceDecisionHistoryId: 12345,
    decisionSystem: "legacy_t5_formal",
    strategyVersion: "legacy-t5-v1",
    modelVersion: "v4-conservative",
    featureVersion: "decision-audit-v1",
    manifestId: "manifest-live-20260805-08-08",
    cohortId: "legacy-formal-forward-2026",
    evaluationMode: "formal_forward",
    ticketType: "trifecta",
    selection: "1-3-4",
    decision: "BUY",
    decisionAt: "2026-08-05T05:26:30.000Z",
    oddsObservedAt: "2026-08-05T05:26:10.000Z",
    scheduledCloseAtSeen: "2026-08-05T05:32:00.000Z",
    currentOdds: 6.4,
    requiredOdds: 5.2,
    estimatedHitRate: 0.231,
    rawEstimatedHitRate: 0.247,
    expectedValue: 1.48,
    recommendedStakeYen: 100,
    sampleSize: 184,
    reasons: ["必要オッズを上回る", "PITデータ完全"],
    warnings: [],
    dataCompleteness: "complete",
    notificationEligible: true,
    notificationDedupeKey: "buy:decision-20260805-08-08",
    sourceRowDigest: "a".repeat(64),
  };
}

test("Runtime Decision Ledger accepts a complete pre-close BUY record", () => {
  assert.deepEqual(validateRuntimeDecisionLedgerRecord(validBuyRecord()), {
    valid: true,
    errors: [],
  });
});

test("Runtime Decision Ledger digest is canonical across object key order", () => {
  const record = validBuyRecord();
  const reversed = Object.fromEntries(Object.entries(record).reverse()) as RuntimeDecisionLedgerRecord;
  assert.equal(runtimeDecisionLedgerDigest(record), runtimeDecisionLedgerDigest(reversed));
  assert.match(runtimeDecisionLedgerDigest(record), /^[0-9a-f]{64}$/);
});

test("Runtime Decision Ledger rejects future odds and post-close decisions", () => {
  const record = validBuyRecord();
  record.oddsObservedAt = "2026-08-05T05:27:00.000Z";
  record.decisionAt = "2026-08-05T05:33:00.000Z";

  const result = validateRuntimeDecisionLedgerRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("decisionAt must not be after scheduledCloseAtSeen"));
  assert.ok(result.errors.includes("oddsObservedAt must not be after decisionAt") === false);

  record.oddsObservedAt = "2026-08-05T05:34:00.000Z";
  const futureOdds = validateRuntimeDecisionLedgerRecord(record);
  assert.ok(futureOdds.errors.includes("oddsObservedAt must not be after decisionAt"));
});

test("Runtime Decision Ledger rejects incomplete BUY records", () => {
  const record = validBuyRecord();
  record.currentOdds = null;
  record.expectedValue = null;
  record.oddsObservedAt = null;
  record.recommendedStakeYen = 0;
  record.dataCompleteness = "partial";

  const result = validateRuntimeDecisionLedgerRecord(record);
  assert.equal(result.valid, false);
  for (const error of [
    "BUY requires dataCompleteness=complete",
    "BUY requires currentOdds",
    "BUY requires expectedValue",
    "BUY requires recommendedStakeYen greater than 0",
    "BUY requires oddsObservedAt",
  ]) {
    assert.ok(result.errors.includes(error), `missing error: ${error}`);
  }
});

test("Runtime Decision Ledger rejects public/analytics fields and non-BUY notification eligibility", () => {
  const record: Record<string, unknown> = {
    ...validBuyRecord(),
    decision: "WATCH",
    recommendedStakeYen: 0,
    notificationEligible: true,
    publicSnapshotUrl: "https://public.example/decision",
  };

  const result = validateRuntimeDecisionLedgerRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("unknown field is not allowed: publicSnapshotUrl"));
  assert.ok(result.errors.includes("notificationEligible may only be true for BUY decisions"));
});

test("Runtime Decision Ledger requires valid source identity and digest", () => {
  const record = validBuyRecord();
  record.sourceDecisionHistoryId = 0;
  record.sourceRowDigest = "not-a-digest";

  const result = validateRuntimeDecisionLedgerRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("sourceDecisionHistoryId must be a positive integer or null"));
  assert.ok(result.errors.includes("sourceRowDigest must be a SHA-256 hex digest"));
});
