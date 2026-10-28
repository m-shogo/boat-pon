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

test("Runtime Decision Ledger rejects integers outside the JavaScript safe range", () => {
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  for (const [field, value] of [
    ["sourceDecisionHistoryId", unsafe],
    ["recommendedStakeYen", unsafe],
    ["sampleSize", unsafe],
  ] as const) {
    const record = validBuyRecord();
    record[field] = value;
    const result = validateRuntimeDecisionLedgerRecord(record);
    assert.equal(result.valid, false, `${field} must fail closed outside the safe integer range`);
  }
});

test("Runtime Decision Ledger validation cannot lose errors when Array.push is replaced", () => {
  const originalPush = Object.getOwnPropertyDescriptor(Array.prototype, "push");
  let observed: { good: boolean; bad: boolean; errors: string[]; digestRejected: boolean };
  try {
    Object.defineProperty(Array.prototype, "push", {
      configurable: true, writable: true,
      value() { return this.length; },
    });
    const good = validBuyRecord();
    const bad = { ...good, sourceRowDigest: "not-a-digest", decision: "UNKNOWN" };
    const result = validateRuntimeDecisionLedgerRecord(bad);
    let digestRejected = false;
    try { runtimeDecisionLedgerDigest(bad as RuntimeDecisionLedgerRecord); }
    catch (error) { digestRejected = error instanceof TypeError; }
    observed = {
      good: validateRuntimeDecisionLedgerRecord(good).valid,
      bad: result.valid,
      errors: result.errors,
      digestRejected,
    };
  } finally {
    if (originalPush) Object.defineProperty(Array.prototype, "push", originalPush);
    else Reflect.deleteProperty(Array.prototype, "push");
  }
  assert.equal(observed.good, true);
  assert.equal(observed.bad, false);
  assert.ok(observed.errors.includes("sourceRowDigest must be a SHA-256 hex digest"));
  assert.ok(observed.errors.includes("decision must be BUY, WATCH, or SKIP"));
  assert.equal(observed.digestRejected, true);
});

test("Runtime Decision Ledger validation verdict and errors are immutable at runtime", () => {
  const invalid = { ...validBuyRecord(), sourceRowDigest: "bad" };
  for (const result of [
    validateRuntimeDecisionLedgerRecord(validBuyRecord()),
    validateRuntimeDecisionLedgerRecord(invalid),
    validateRuntimeDecisionLedgerRecord(null),
  ]) {
    const valid = result.valid;
    const errors = [...result.errors];
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.errors), true);
    assert.throws(() => { result.valid = !valid; }, TypeError);
    assert.throws(() => { result.errors.push("forged"); }, TypeError);
    assert.deepEqual(result, { valid, errors });
  }
});

test("Runtime Decision Ledger admission is stable under ambient Set.has and iterator hooks", () => {
  const good = validBuyRecord();
  const expectedDigest = runtimeDecisionLedgerDigest(good);
  const malformed = {
    ...good,
    decision: "UNKNOWN",
    evaluationMode: "unapproved",
    dataCompleteness: "unknown",
    notificationEligible: false,
    notificationDedupeKey: null,
    unapprovedResearchField: "must be denied",
  };
  const missing: Record<string, unknown> = {
    ...good, decision: "WATCH", notificationEligible: false, notificationDedupeKey: null,
  };
  delete missing.evaluationMode;

  const originalHas = Object.getOwnPropertyDescriptor(Set.prototype, "has")!;
  const originalIterator = Object.getOwnPropertyDescriptor(Set.prototype, Symbol.iterator)!;
  let goodValid = false;
  let goodDigest = "";
  let invalid: ReturnType<typeof validateRuntimeDecisionLedgerRecord> | undefined;
  let absent: ReturnType<typeof validateRuntimeDecisionLedgerRecord> | undefined;
  let digestRejected = false;
  try {
    Object.defineProperty(Set.prototype, "has", {
      configurable: true, writable: true, value() { return true; },
    });
    Object.defineProperty(Set.prototype, Symbol.iterator, {
      configurable: true, writable: true, value: function* () {},
    });
    goodValid = validateRuntimeDecisionLedgerRecord(good).valid;
    goodDigest = runtimeDecisionLedgerDigest(good);
    invalid = validateRuntimeDecisionLedgerRecord(malformed);
    absent = validateRuntimeDecisionLedgerRecord(missing);
    try { runtimeDecisionLedgerDigest(malformed as RuntimeDecisionLedgerRecord); }
    catch (error) { digestRejected = error instanceof TypeError; }
  } finally {
    Object.defineProperty(Set.prototype, Symbol.iterator, originalIterator);
    Object.defineProperty(Set.prototype, "has", originalHas);
  }

  assert.equal(goodValid, true);
  assert.equal(goodDigest, expectedDigest);
  assert.equal(invalid?.valid, false);
  assert.ok(invalid?.errors.includes("decision must be BUY, WATCH, or SKIP"));
  assert.ok(invalid?.errors.includes("evaluationMode is invalid"));
  assert.ok(invalid?.errors.includes("dataCompleteness is invalid"));
  assert.ok(invalid?.errors.includes("unknown field is not allowed: unapprovedResearchField"));
  assert.equal(absent?.valid, false);
  assert.ok(absent?.errors.includes("missing own field: evaluationMode"));
  assert.equal(digestRejected, true);
});

test("Runtime Decision Ledger rejects Proxy getter/descriptor disagreement before any caller hook", () => {
  const good = validBuyRecord();
  const baselineDigest = runtimeDecisionLedgerDigest(good);
  const underlying = { ...good, currentOdds: -100 };
  let reads = 0;
  const disguised = new Proxy(underlying, {
    get(target, key, receiver) {
      if (key === "currentOdds") { reads += 1; return good.currentOdds; }
      return Reflect.get(target, key, receiver);
    },
  });
  // Before Proxy denial, validation read 6.4 while canonical hashing read
  // the own data descriptor -100, accepting a digest for an invalid record.
  assert.equal(validateRuntimeDecisionLedgerRecord(disguised).valid, false);
  assert.throws(() => runtimeDecisionLedgerDigest(disguised), TypeError);
  assert.equal(reads, 0, "Proxy getter must not execute during admission");

  const revoked = Proxy.revocable({ ...good }, {});
  revoked.revoke();
  assert.equal(validateRuntimeDecisionLedgerRecord(revoked.proxy).valid, false);
  assert.throws(() => runtimeDecisionLedgerDigest(revoked.proxy), TypeError);
  assert.equal(validateRuntimeDecisionLedgerRecord(good).valid, true);
  assert.equal(runtimeDecisionLedgerDigest(good), baselineDigest);
});

test("Runtime Decision Ledger rejects nested Proxy reason arrays, including revoked arrays", () => {
  const good = validBuyRecord();
  const baselineDigest = runtimeDecisionLedgerDigest(good);
  let reads = 0;
  const reasons = new Proxy([...good.reasons], {
    get(target, key, receiver) {
      reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const disguised = { ...good, reasons };
  assert.equal(validateRuntimeDecisionLedgerRecord(disguised).valid, false);
  assert.throws(() => runtimeDecisionLedgerDigest(disguised), TypeError);
  assert.equal(reads, 0, "nested Proxy traps must not execute");

  const revoked = Proxy.revocable([...good.warnings], {});
  revoked.revoke();
  const withRevoked = { ...good, warnings: revoked.proxy };
  assert.equal(validateRuntimeDecisionLedgerRecord(withRevoked).valid, false);
  assert.throws(() => runtimeDecisionLedgerDigest(withRevoked), TypeError);
  assert.equal(runtimeDecisionLedgerDigest(good), baselineDigest);
});
