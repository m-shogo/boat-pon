import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION,
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
