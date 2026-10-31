import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION as V,
  validateOutcomeLearningLedgerRecord,
  outcomeLearningLedgerDigest,
  classifyOutcomeLedgerAppend,
  classifyOutcomeReconciliation,
  type OutcomeLearningLedgerRecord,
} from "./outcomeLearningLedger";

function settled(): OutcomeLearningLedgerRecord {
  return {
    schemaVersion: V, outcomeRecordId: "outcome:synthetic",
    decisionRecordId: "runtime:synthetic", decisionId: "decision:synthetic",
    canonicalRaceId: "race:synthetic", ticketType: "trifecta",
    selection: "1-2-3", settlementId: "settlement:synthetic",
    settledAt: "2026-10-21T00:00:00.000Z", finality: "FINAL",
    disposition: "SETTLED", evaluable: true,
    stakeYen: 100, payoutYen: 500, refundYen: 0,
    refundReason: null, popularity: 2,
    sourceEvidenceDigests: ["a".repeat(64)], provenanceVersion: "synthetic-v1",
  };
}
function withEmptyIterator<T>(fn: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true, writable: true,
      value: function* () { /* synthetic hostile empty iterator */ },
    });
    return fn();
  } finally {
    if (previous) Object.defineProperty(Array.prototype, Symbol.iterator, previous);
    else Reflect.deleteProperty(Array.prototype, Symbol.iterator);
  }
}
test("Outcome rejects invalid required, monetary, unknown and impossible dates under hostile iterator", () => {
  const good = settled();
  const badId = { ...good, outcomeRecordId: "" };
  const badMoney = { ...good, stakeYen: -1, payoutYen: -1 };
  const extra = { ...good, unexpectedResearchField: "invalid" };
  const impossible = { ...good, settledAt: "2026-02-30T00:00:00.000Z" };
  const baselineDigest = outcomeLearningLedgerDigest(good);
  const observed = withEmptyIterator(() => ({
    good: validateOutcomeLearningLedgerRecord(good).valid,
    goodDigest: outcomeLearningLedgerDigest(good),
    badId: validateOutcomeLearningLedgerRecord(badId).valid,
    badMoney: validateOutcomeLearningLedgerRecord(badMoney).valid,
    extra: validateOutcomeLearningLedgerRecord(extra).valid,
    impossible: validateOutcomeLearningLedgerRecord(impossible).valid,
    append: classifyOutcomeLedgerAppend(undefined, badMoney),
    digestThrows: (() => { try { outcomeLearningLedgerDigest(badId); return false; } catch (e) { return e instanceof TypeError; } })(),
  }));
  assert.deepEqual(observed, {
    good: true, goodDigest: baselineDigest, badId: false,
    badMoney: false, extra: false, impossible: false,
    append: "REJECTED_INVALID", digestThrows: true,
  });
});
test("Outcome reconciliation examines every boolean flag without iterator", () => {
  const flags = {
    decisionExact: true, settlementIdentityExact: true, ticketLinkExact: true,
    refundOrInvalidationExact: true, finalityExact: true,
  };
  const observed = withEmptyIterator(() => ({
    exact: classifyOutcomeReconciliation(flags),
    invalid: classifyOutcomeReconciliation({ ...flags, ticketLinkExact: "yes" } as unknown as typeof flags),
  }));
  assert.deepEqual(observed, { exact: "EXACT", invalid: "REJECTED_INVALID" });
});
test("Outcome canonical digest ignores poisoned map/sort and retains evidence identity", () => {
  const a = settled(), b = { ...settled(), sourceEvidenceDigests: ["b".repeat(64)] };
  const expectedA = outcomeLearningLedgerDigest(a), expectedB = outcomeLearningLedgerDigest(b);
  assert.notEqual(expectedA, expectedB);
  const map = Object.getOwnPropertyDescriptor(Array.prototype, "map")!;
  const sort = Object.getOwnPropertyDescriptor(Array.prototype, "sort")!;
  let observed: [string, string] | undefined;
  try {
    Object.defineProperty(Array.prototype, "map", { configurable: true, writable: true, value() { return []; } });
    Object.defineProperty(Array.prototype, "sort", { configurable: true, writable: true, value() { return this; } });
    observed = [outcomeLearningLedgerDigest(a), outcomeLearningLedgerDigest(b)];
  } finally {
    Object.defineProperty(Array.prototype, "map", map);
    Object.defineProperty(Array.prototype, "sort", sort);
  }
  assert.deepEqual(observed, [expectedA, expectedB]);
});
test("Outcome rejects duplicate digests despite iterator substitution and inherited array toJSON", () => {
  const a = settled();
  a.sourceEvidenceDigests = ["a".repeat(64), "a".repeat(64)];
  const result = withEmptyIterator(() => validateOutcomeLearningLedgerRecord(a));
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("sourceEvidenceDigests must not contain duplicates"));
  const valid = settled();
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  try {
    Object.defineProperty(Array.prototype, "toJSON", { configurable: true, value() { return []; } });
    assert.equal(validateOutcomeLearningLedgerRecord(valid).valid, false);
    assert.throws(() => outcomeLearningLedgerDigest(valid), TypeError);
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "toJSON", previous);
    else Reflect.deleteProperty(Array.prototype, "toJSON");
  }
});
test("Outcome safe integer limits agree with JSON Schema", () => {
  const base = settled();
  for (const field of ["stakeYen", "payoutYen", "popularity"] as const) {
    assert.equal(validateOutcomeLearningLedgerRecord({ ...base, [field]: Number.MAX_SAFE_INTEGER }).valid, true);
    assert.equal(validateOutcomeLearningLedgerRecord({ ...base, [field]: Number.MAX_SAFE_INTEGER + 1 }).valid, false);
  }
});
