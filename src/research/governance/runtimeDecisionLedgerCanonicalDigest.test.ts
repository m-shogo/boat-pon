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

  assert.match(runtimeDecisionLedgerDigest(canonical), /^[0-9a-f]{64}$/);
  assert.throws(
    () => runtimeDecisionLedgerDigest(uppercase),
    TypeError,
    "invalid uppercase source digests must fail before canonical hashing",
  );
});

test("Runtime Ledger digest remains canonical under overridden array helpers", () => {
  const first = record("a".repeat(64));
  const second = record("b".repeat(64));
  const reordered = Object.fromEntries(Object.entries(first).reverse()) as RuntimeDecisionLedgerRecord;
  const baselineFirst = runtimeDecisionLedgerDigest(first);
  const baselineSecond = runtimeDecisionLedgerDigest(second);
  assert.notEqual(baselineFirst, baselineSecond);
  assert.equal(runtimeDecisionLedgerDigest(reordered), baselineFirst);

  const originalFrom = Object.getOwnPropertyDescriptor(Array, "from")!;
  const originalMap = Object.getOwnPropertyDescriptor(Array.prototype, "map")!;
  const originalSort = Object.getOwnPropertyDescriptor(Array.prototype, "sort")!;
  let observed: { first: string; second: string; reordered: string } | undefined;
  try {
    Object.defineProperty(Array, "from", { configurable: true, writable: true, value() { return []; } });
    Object.defineProperty(Array.prototype, "map", { configurable: true, writable: true, value() { return []; } });
    Object.defineProperty(Array.prototype, "sort", { configurable: true, writable: true, value() { return this; } });
    observed = {
      first: runtimeDecisionLedgerDigest(first),
      second: runtimeDecisionLedgerDigest(second),
      reordered: runtimeDecisionLedgerDigest(reordered),
    };
  } finally {
    Object.defineProperty(Array, "from", originalFrom);
    Object.defineProperty(Array.prototype, "map", originalMap);
    Object.defineProperty(Array.prototype, "sort", originalSort);
  }
  assert.deepEqual(observed, {
    first: baselineFirst,
    second: baselineSecond,
    reordered: baselineFirst,
  });
});
