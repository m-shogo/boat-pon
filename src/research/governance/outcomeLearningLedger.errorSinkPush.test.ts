import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION as V,
  validateOutcomeLearningLedgerRecord, outcomeLearningLedgerDigest,
  classifyOutcomeLedgerAppend, classifyOutcomeReconciliation,
  type OutcomeLearningLedgerRecord,
} from "./outcomeLearningLedger";

function settled(): OutcomeLearningLedgerRecord {
  return { schemaVersion: V, outcomeRecordId: "outcome:push-fixture",
    decisionRecordId: "runtime:push-fixture", decisionId: "decision:push-fixture",
    canonicalRaceId: "race:push-fixture", ticketType: "trifecta", selection: "1-2-3",
    settlementId: "settlement:push-fixture", settledAt: "2026-10-21T00:00:00.000Z",
    finality: "FINAL", disposition: "SETTLED", evaluable: true,
    stakeYen: 100, payoutYen: 500, refundYen: 0, refundReason: null, popularity: 2,
    sourceEvidenceDigests: ["a".repeat(64)], provenanceVersion: "synthetic-v1" };
}
function withNoopPush<T>(fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "push");
  try {
    Object.defineProperty(Array.prototype, "push", { configurable: true, writable: true, value() { return this.length; } });
    return fn();
  } finally {
    if (original) Object.defineProperty(Array.prototype, "push", original);
    else Reflect.deleteProperty(Array.prototype, "push");
  }
}
test("Outcome Ledger validation and reconciliation do not depend on Array.push", () => {
  const good = settled(), bad = { ...good, outcomeRecordId: "" };
  const flags = { decisionExact: true, settlementIdentityExact: true, ticketLinkExact: true,
    refundOrInvalidationExact: true, finalityExact: true };
  const observed = withNoopPush(() => ({
    good: validateOutcomeLearningLedgerRecord(good).valid,
    bad: validateOutcomeLearningLedgerRecord(bad).valid,
    append: classifyOutcomeLedgerAppend(undefined, bad),
    digestRejected: (() => { try { outcomeLearningLedgerDigest(bad); return false; } catch (e) { return e instanceof TypeError; } })(),
    exact: classifyOutcomeReconciliation(flags),
    unresolved: classifyOutcomeReconciliation({ ...flags, ticketLinkExact: false }),
  }));
  assert.deepEqual(observed, { good: true, bad: false, append: "REJECTED_INVALID",
    digestRejected: true, exact: "EXACT", unresolved: "UNRESOLVED_TICKET_LINK" });
});
