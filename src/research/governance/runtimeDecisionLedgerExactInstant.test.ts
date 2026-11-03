import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
  runtimeDecisionLedgerDigest,
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

// Exact chronology cannot be established from millisecond-truncated Date.parse alone.
test("Runtime Decision Ledger compares submillisecond PIT timestamps", () => {
  const candidate = record();
  candidate.decisionAt = "2026-10-19T01:00:00.0001000Z";
  candidate.oddsObservedAt = "2026-10-19T10:00:00.0000999+09:00";
  candidate.scheduledCloseAtSeen = "2026-10-19T01:00:00.0001001Z";
  assert.equal(validateRuntimeDecisionLedgerRecord(candidate).valid, true);
  candidate.oddsObservedAt = "2026-10-19T01:00:00.0001001Z";
  assert.ok(validateRuntimeDecisionLedgerRecord(candidate).errors.includes("oddsObservedAt must not be after decisionAt"));
  candidate.oddsObservedAt = "2026-10-19T01:00:00.0000999Z";
  candidate.scheduledCloseAtSeen = "2026-10-19T01:00:00.0000999Z";
  assert.ok(validateRuntimeDecisionLedgerRecord(candidate).errors.includes("decisionAt must not be after scheduledCloseAtSeen"));
});

test("Runtime Decision Ledger rejects unknown UTC offsets and year zero", () => {
  for (const field of ["decisionAt", "oddsObservedAt", "scheduledCloseAtSeen"] as const) {
    const candidate = record();
    candidate[field] = "2026-10-19T01:00:00-00:00";
    assert.equal(validateRuntimeDecisionLedgerRecord(candidate).valid, false, field);
  }
  const candidate = record();
  candidate.decisionAt = "0000-01-01T00:00:01Z";
  candidate.oddsObservedAt = "0000-01-01T00:00:00Z";
  candidate.scheduledCloseAtSeen = "0000-01-01T00:00:02Z";
  assert.equal(validateRuntimeDecisionLedgerRecord(candidate).valid, false);
});

test("Runtime Decision Ledger preserves known UTC offsets and equal submillisecond instants", () => {
  const candidate = record();
  candidate.oddsObservedAt = "2026-10-19T10:00:00.0001+09:00";
  candidate.decisionAt = "2026-10-19T01:00:00.0001000Z";
  candidate.scheduledCloseAtSeen = "2026-10-19T01:00:00.0001001+00:00";
  assert.deepEqual(validateRuntimeDecisionLedgerRecord(candidate), { valid: true, errors: [] });
});

test("Runtime Decision Ledger date validation ignores a hostile array iterator", () => {
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  let observed: { good: boolean; invalid: boolean; errors: string[]; digestRejected: boolean; invalidId: boolean; unknownField: boolean; invalidOdds: boolean; hiddenSymbol: boolean };
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true, writable: true,
      value: function* () { /* synthetic empty iterator */ },
    });
    const good = record();
    const impossible = record();
    impossible.decisionAt = "2026-02-30T05:26:30Z";
    impossible.oddsObservedAt = null;
    impossible.scheduledCloseAtSeen = "2026-03-03T05:32:00Z";
    const result = validateRuntimeDecisionLedgerRecord(impossible);
    let digestRejected = false;
    try { runtimeDecisionLedgerDigest(impossible); }
    catch (error) { digestRejected = error instanceof TypeError; }
    observed = {
      good: validateRuntimeDecisionLedgerRecord(good).valid,
      invalid: result.valid,
      errors: result.errors,
      digestRejected,
      invalidId: validateRuntimeDecisionLedgerRecord({ ...record(), recordId: "" }).valid,
      unknownField: validateRuntimeDecisionLedgerRecord({ ...record(), unexpected: "research-only" }).valid,
      invalidOdds: validateRuntimeDecisionLedgerRecord({ ...record(), currentOdds: "not-a-number" }).valid,
      hiddenSymbol: validateRuntimeDecisionLedgerRecord({ ...record(), [Symbol("hidden")]: "not-json" }).valid,
    };
  } finally {
    if (previous) Object.defineProperty(Array.prototype, Symbol.iterator, previous);
    else Reflect.deleteProperty(Array.prototype, Symbol.iterator);
  }
  assert.equal(observed.good, true);
  assert.equal(observed.invalid, false);
  assert.ok(observed.errors.includes("decisionAt must be a valid timezone-bound ISO timestamp"));
  assert.equal(observed.digestRejected, true);
  assert.equal(observed.invalidId, false);
  assert.equal(observed.unknownField, false);
  assert.equal(observed.invalidOdds, false);
  assert.equal(observed.hiddenSymbol, false);
});
