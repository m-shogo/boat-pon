import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION,
  classifyOutcomeLedgerAppend,
  classifyOutcomeReconciliation,
  outcomeLearningLedgerDigest,
  validateOutcomeLearningLedgerRecord,
  type OutcomeLearningLedgerRecord,
} from "./outcomeLearningLedger";

function validSettled(): OutcomeLearningLedgerRecord {
  return {
    schemaVersion: OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION,
    outcomeRecordId: "outcome:decision-1:settlement-1",
    decisionRecordId: "runtime:decision-1",
    decisionId: "decision-1",
    canonicalRaceId: "fixture-race-1",
    ticketType: "trifecta",
    selection: "1-3-4",
    settlementId: "settlement-1",
    settledAt: "2026-08-05T06:00:00.000Z",
    finality: "FINAL",
    disposition: "SETTLED",
    evaluable: true,
    stakeYen: 100,
    payoutYen: 640,
    refundYen: 0,
    refundReason: null,
    popularity: 2,
    sourceEvidenceDigests: ["a".repeat(64)],
    provenanceVersion: "fixture-v1",
  };
}

test("Outcome Learning Ledger accepts an exact terminal settlement", () => {
  assert.deepEqual(validateOutcomeLearningLedgerRecord(validSettled()), { valid: true, errors: [] });
});

test("Outcome Learning Ledger digest is canonical across object key order", () => {
  const record = validSettled();
  const reversed = Object.fromEntries(Object.entries(record).reverse()) as OutcomeLearningLedgerRecord;
  assert.equal(outcomeLearningLedgerDigest(record), outcomeLearningLedgerDigest(reversed));
  assert.match(outcomeLearningLedgerDigest(record), /^[0-9a-f]{64}$/);
});

test("Outcome Learning Ledger append classification is idempotent and fail-closed", () => {
  const existing = validSettled();
  const reordered = Object.fromEntries(Object.entries(existing).reverse()) as OutcomeLearningLedgerRecord;
  assert.equal(classifyOutcomeLedgerAppend(undefined, existing), "APPEND");
  assert.equal(classifyOutcomeLedgerAppend(existing, reordered), "IDEMPOTENT_NOOP");

  const changedPayload = { ...existing, payoutYen: existing.payoutYen + 1 };
  assert.equal(classifyOutcomeLedgerAppend(existing, changedPayload), "CONFLICT");

  const differentIdentity = { ...existing, outcomeRecordId: "outcome:decision-1:settlement-2" };
  assert.equal(classifyOutcomeLedgerAppend(existing, differentIdentity), "CONFLICT");

  assert.equal(classifyOutcomeLedgerAppend(existing, { ...existing, payoutYen: -1 }), "REJECTED_INVALID");
});

test("Outcome Learning Ledger rejects unknown/public fields and invalid evidence digests", () => {
  const record: Record<string, unknown> = { ...validSettled(), publicUrl: "https://example.invalid", sourceEvidenceDigests: ["bad"] };
  const result = validateOutcomeLearningLedgerRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("unknown field is not allowed: publicUrl"));
  assert.ok(result.errors.includes("sourceEvidenceDigests must contain one or more lowercase SHA-256 digests"));
});

test("refund and void semantics cannot be coerced into ordinary evaluable losses", () => {
  const refunded = validSettled();
  refunded.disposition = "REFUNDED";
  refunded.refundYen = 100;
  refunded.refundReason = "authoritative refund";
  refunded.evaluable = true;
  assert.ok(validateOutcomeLearningLedgerRecord(refunded).errors.includes("REFUNDED must not be evaluable by default"));

  const voided = validSettled();
  voided.disposition = "VOID";
  voided.finality = "VOID";
  voided.refundReason = "authoritative cancellation";
  voided.evaluable = true;
  assert.ok(validateOutcomeLearningLedgerRecord(voided).errors.includes("VOID must not be evaluable"));
});

test("unresolved reconciliation remains outside exact ledger admission", () => {
  assert.equal(classifyOutcomeReconciliation({ decisionExact: false, settlementIdentityExact: true, ticketLinkExact: true, refundOrInvalidationExact: true, finalityExact: true }), "UNRESOLVED_DECISION");
  assert.equal(classifyOutcomeReconciliation({ decisionExact: true, settlementIdentityExact: true, ticketLinkExact: false, refundOrInvalidationExact: true, finalityExact: true }), "UNRESOLVED_TICKET_LINK");
  assert.equal(classifyOutcomeReconciliation({ decisionExact: true, settlementIdentityExact: true, ticketLinkExact: true, refundOrInvalidationExact: false, finalityExact: true }), "UNRESOLVED_REFUND_OR_INVALIDATION");
  assert.equal(classifyOutcomeReconciliation({ decisionExact: true, settlementIdentityExact: true, ticketLinkExact: true, refundOrInvalidationExact: true, finalityExact: false }), "UNRESOLVED_FINALITY");
  assert.equal(classifyOutcomeReconciliation({ decisionExact: true, settlementIdentityExact: true, ticketLinkExact: true, refundOrInvalidationExact: true, finalityExact: true }), "EXACT");
});

test("Outcome Learning Ledger rejects unsafe monetary integers and duplicate evidence", () => {
  const record = validSettled();
  record.stakeYen = Number.MAX_SAFE_INTEGER + 1;
  record.sourceEvidenceDigests = ["a".repeat(64), "a".repeat(64)];
  const result = validateOutcomeLearningLedgerRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("stakeYen must be a non-negative safe integer"));
  assert.ok(result.errors.includes("sourceEvidenceDigests must not contain duplicates"));
});

test("direct Outcome Ledger digest rejects invalid JSON aliases and malformed existing state", () => {
  const valid = validSettled();
  const invalidPayouts: unknown[] = [Number.NaN, Infinity, -Infinity, null, undefined, -1, Number.MAX_SAFE_INTEGER + 1, "640"];
  const nullRecord = { ...valid, payoutYen: null };
  for (const invalid of invalidPayouts) {
    const malformed = { ...valid, payoutYen: invalid } as unknown as OutcomeLearningLedgerRecord;
    assert.equal(validateOutcomeLearningLedgerRecord(malformed).valid, false);
    assert.throws(() => outcomeLearningLedgerDigest(malformed), TypeError);
    assert.equal(classifyOutcomeLedgerAppend(valid, malformed), "REJECTED_INVALID");
    assert.equal(classifyOutcomeLedgerAppend(malformed, valid), "REJECTED_INVALID");
    if (typeof invalid === "number" && !Number.isFinite(invalid)) {
      assert.equal(JSON.stringify(malformed), JSON.stringify(nullRecord));
    }
  }
  const missingPayout = { ...valid } as Record<string, unknown>;
  delete missingPayout.payoutYen;
  assert.equal(JSON.stringify({ ...valid, payoutYen: undefined }), JSON.stringify(missingPayout));
  assert.equal(classifyOutcomeLedgerAppend(undefined, valid), "APPEND");
  assert.match(outcomeLearningLedgerDigest(valid), /^[0-9a-f]{64}$/u);
});

test("Outcome Ledger JSON admission rejects inherited, exotic, hidden, accessor and sparse evidence", () => {
  const valid = validSettled();
  const inherited = Object.create(valid) as OutcomeLearningLedgerRecord;
  const exotic = Object.assign(new Date("2026-08-05T06:00:00Z"), valid) as unknown as OutcomeLearningLedgerRecord;
  const hidden = { ...valid };
  Object.defineProperty(hidden, "payoutYen", { value: 640, enumerable: false, configurable: true });
  const withSymbol = { ...valid, [Symbol("hidden")]: "not serialized" };
  let getterReads = 0;
  const accessor = { ...valid };
  Object.defineProperty(accessor, "payoutYen", {
    enumerable: true, configurable: true,
    get() { getterReads++; return 640; },
  });
  const sparse = { ...valid, sourceEvidenceDigests: new Array<string>(1) };
  const alteredArray = { ...valid, sourceEvidenceDigests: ["a".repeat(64)] };
  Object.defineProperty(alteredArray.sourceEvidenceDigests, "toJSON", {
    value() { return ["b".repeat(64)]; }, configurable: true,
  });
  for (const malformed of [inherited, exotic, hidden, withSymbol, accessor, sparse, alteredArray]) {
    assert.equal(validateOutcomeLearningLedgerRecord(malformed).valid, false);
    assert.throws(() => outcomeLearningLedgerDigest(malformed), TypeError);
    assert.equal(classifyOutcomeLedgerAppend(malformed, valid), "REJECTED_INVALID");
    assert.equal(classifyOutcomeLedgerAppend(valid, malformed), "REJECTED_INVALID");
  }
  assert.equal(getterReads, 0);
  assert.equal(validateOutcomeLearningLedgerRecord(valid).valid, true);
  assert.equal(outcomeLearningLedgerDigest(valid), outcomeLearningLedgerDigest({ ...valid }));
});

test("Outcome Learning Ledger validation verdict and errors are immutable at runtime", () => {
  const invalid = { ...validSettled(), payoutYen: -1 };
  for (const result of [
    validateOutcomeLearningLedgerRecord(validSettled()),
    validateOutcomeLearningLedgerRecord(invalid),
    validateOutcomeLearningLedgerRecord(null),
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

test("Outcome Learning Ledger rejects Proxy getter/descriptor disagreement without executing hooks", () => {
  const good = validSettled();
  const expectedDigest = outcomeLearningLedgerDigest(good);
  const underlying = { ...good, payoutYen: -1 };
  let reads = 0;
  const disguised = new Proxy(underlying, {
    get(target, key, receiver) {
      if (key === "payoutYen") { reads += 1; return good.payoutYen; }
      return Reflect.get(target, key, receiver);
    },
  });
  assert.equal(validateOutcomeLearningLedgerRecord(disguised).valid, false);
  assert.equal(classifyOutcomeLedgerAppend(undefined, disguised), "REJECTED_INVALID");
  assert.throws(() => outcomeLearningLedgerDigest(disguised), TypeError);
  assert.equal(reads, 0);

  const revoked = Proxy.revocable({ ...good }, {});
  revoked.revoke();
  assert.equal(validateOutcomeLearningLedgerRecord(revoked.proxy).valid, false);
  assert.equal(classifyOutcomeLedgerAppend(undefined, revoked.proxy), "REJECTED_INVALID");
  assert.throws(() => outcomeLearningLedgerDigest(revoked.proxy), TypeError);
  assert.equal(outcomeLearningLedgerDigest(good), expectedDigest);
});

test("Outcome Learning Ledger rejects nested Proxy evidence arrays without consulting traps", () => {
  const good = validSettled();
  const expectedDigest = outcomeLearningLedgerDigest(good);
  let reads = 0;
  const evidence = new Proxy([...good.sourceEvidenceDigests], {
    get(target, key, receiver) {
      reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const candidate = { ...good, sourceEvidenceDigests: evidence };
  assert.equal(validateOutcomeLearningLedgerRecord(candidate).valid, false);
  assert.equal(classifyOutcomeLedgerAppend(undefined, candidate), "REJECTED_INVALID");
  assert.throws(() => outcomeLearningLedgerDigest(candidate), TypeError);
  assert.equal(reads, 0);

  const revoked = Proxy.revocable([...good.sourceEvidenceDigests], {});
  revoked.revoke();
  const invalid = { ...good, sourceEvidenceDigests: revoked.proxy };
  assert.equal(validateOutcomeLearningLedgerRecord(invalid).valid, false);
  assert.equal(classifyOutcomeLedgerAppend(undefined, invalid), "REJECTED_INVALID");
  assert.throws(() => outcomeLearningLedgerDigest(invalid), TypeError);
  assert.equal(outcomeLearningLedgerDigest(good), expectedDigest);
});
