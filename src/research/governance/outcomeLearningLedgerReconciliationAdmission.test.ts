import assert from "node:assert/strict";
import test from "node:test";
import { classifyOutcomeReconciliation } from "./outcomeLearningLedger";

const exact = {
  decisionExact: true,
  settlementIdentityExact: true,
  ticketLinkExact: true,
  refundOrInvalidationExact: true,
  finalityExact: true,
};
const classify = (value: unknown) =>
  classifyOutcomeReconciliation(value as Parameters<typeof classifyOutcomeReconciliation>[0]);

test("reconciliation only returns EXACT for five own boolean data flags", () => {
  assert.equal(classify(exact), "EXACT");
  for (const [field, expected] of [
    ["decisionExact", "UNRESOLVED_DECISION"],
    ["settlementIdentityExact", "UNRESOLVED_SETTLEMENT_IDENTITY"],
    ["ticketLinkExact", "UNRESOLVED_TICKET_LINK"],
    ["refundOrInvalidationExact", "UNRESOLVED_REFUND_OR_INVALIDATION"],
    ["finalityExact", "UNRESOLVED_FINALITY"],
  ] as const) {
    assert.equal(classify({ ...exact, [field]: false }), expected);
  }
  assert.equal(classify({ ...exact, decisionExact: false, finalityExact: false }), "UNRESOLVED_DECISION");
});

test("truthy non-booleans, inherited flags and non-JSON shapes cannot claim EXACT", () => {
  let getterReads = 0;
  const accessor = { ...exact };
  Object.defineProperty(accessor, "decisionExact", {
    enumerable: true, get() { getterReads++; return true; },
  });
  const hidden = { ...exact };
  Object.defineProperty(hidden, "finalityExact", { value: true, enumerable: false });
  const missing = { ...exact } as Partial<typeof exact>;
  delete missing.ticketLinkExact;
  const malformed: unknown[] = [
    null, [], { ...exact, decisionExact: "false" },
    { ...exact, finalityExact: 1 },
    { ...exact, refundOrInvalidationExact: {} },
    { ...exact, extra: true }, { ...exact, [Symbol("hidden")]: true },
    Object.create(exact), accessor, hidden, missing,
    new Proxy({ ...exact }, { ownKeys() { throw new Error("blocked"); } }),
  ];
  for (const candidate of malformed) assert.equal(classify(candidate), "REJECTED_INVALID");
  assert.equal(getterReads, 0);
});
