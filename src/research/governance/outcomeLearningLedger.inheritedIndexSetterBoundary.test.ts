import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION,
  classifyOutcomeLedgerAppend,
  outcomeLearningLedgerDigest,
  validateOutcomeLearningLedgerRecord,
  type OutcomeLearningLedgerRecord,
} from "./outcomeLearningLedger";

function settled(): OutcomeLearningLedgerRecord {
  return {
    schemaVersion: OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION,
    outcomeRecordId: "outcome:synthetic-index-setter",
    decisionRecordId: "runtime:synthetic-index-setter",
    decisionId: "decision:synthetic-index-setter",
    canonicalRaceId: "race:synthetic-index-setter",
    ticketType: "trifecta",
    selection: "1-2-3",
    settlementId: "settlement:synthetic-index-setter",
    settledAt: "2026-10-21T00:00:00.000Z",
    finality: "FINAL",
    disposition: "SETTLED",
    evaluable: true,
    stakeYen: 100,
    payoutYen: 500,
    refundYen: 0,
    refundReason: null,
    popularity: 2,
    sourceEvidenceDigests: ["a".repeat(64)],
    provenanceVersion: "synthetic-v1",
  };
}

function withInheritedSetter<T>(index: number, run: () => T): { value: T; setterCalls: number } {
  const key = String(index);
  const original = Object.getOwnPropertyDescriptor(Array.prototype, key);
  let setterCalls = 0;
  try {
    Object.defineProperty(Array.prototype, key, {
      configurable: true,
      set(_value: unknown) { setterCalls++; },
    });
    return { value: run(), setterCalls };
  } finally {
    if (original) Object.defineProperty(Array.prototype, key, original);
    else Reflect.deleteProperty(Array.prototype, key);
  }
}

test("Outcome Ledger rejects malformed evidence even with an inherited index-zero setter", () => {
  const invalid = { ...settled(), outcomeRecordId: "" };
  const observed = withInheritedSetter(0, () => ({
    validation: validateOutcomeLearningLedgerRecord(invalid),
    append: classifyOutcomeLedgerAppend(undefined, invalid),
    digestThrows: (() => {
      try { outcomeLearningLedgerDigest(invalid); return false; }
      catch (error) { return error instanceof TypeError; }
    })(),
  }));
  assert.equal(observed.value.validation.valid, false);
  assert.ok(observed.value.validation.errors.includes("outcomeRecordId must be a non-empty string"));
  assert.equal(observed.value.append, "REJECTED_INVALID");
  assert.equal(observed.value.digestThrows, true);
  assert.equal(observed.setterCalls, 0, "validation errors must be own data properties");
});

test("Outcome Ledger keeps distinct high-index evidence digests distinct under inherited setters", () => {
  const sourceEvidenceDigests = Array.from({ length: 18 }, (_, index) =>
    (index + 1).toString(16).padStart(64, "0"));
  const original = settled();
  original.sourceEvidenceDigests = sourceEvidenceDigests;
  const changed = settled();
  changed.sourceEvidenceDigests = Array.from(sourceEvidenceDigests, (digest, index) =>
    index === 17 ? "f".repeat(64) : digest);
  assert.equal(validateOutcomeLearningLedgerRecord(original).valid, true);
  assert.equal(validateOutcomeLearningLedgerRecord(changed).valid, true);
  const baselineA = outcomeLearningLedgerDigest(original);
  const baselineB = outcomeLearningLedgerDigest(changed);
  assert.notEqual(baselineA, baselineB);

  const observed = withInheritedSetter(17, () => ({
    digestA: outcomeLearningLedgerDigest(original),
    digestB: outcomeLearningLedgerDigest(changed),
    append: classifyOutcomeLedgerAppend(original, changed),
  }));
  assert.deepEqual(observed.value, {
    digestA: baselineA,
    digestB: baselineB,
    append: "CONFLICT",
  });
  assert.equal(observed.setterCalls, 0, "canonical output must define own array data properties");
});
