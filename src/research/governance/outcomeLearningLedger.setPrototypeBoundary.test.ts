import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION,
  classifyOutcomeLedgerAppend,
  outcomeLearningLedgerDigest,
  validateOutcomeLearningLedgerRecord,
  type OutcomeLearningLedgerRecord,
} from "./outcomeLearningLedger";

// Synthetic research metadata only. No settlement source or production input.
function settled(): OutcomeLearningLedgerRecord {
  return {
    schemaVersion: OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION,
    outcomeRecordId: "outcome:synthetic:1",
    decisionRecordId: "runtime:synthetic:1",
    decisionId: "synthetic:1",
    canonicalRaceId: "synthetic-race",
    ticketType: "trifecta",
    selection: "1-2-3",
    settlementId: "synthetic-settlement",
    settledAt: "2026-08-05T06:00:00.000Z",
    finality: "FINAL",
    disposition: "SETTLED",
    evaluable: true,
    stakeYen: 100,
    payoutYen: 640,
    refundYen: 0,
    refundReason: null,
    popularity: 1,
    sourceEvidenceDigests: ["a".repeat(64)],
    provenanceVersion: "synthetic-v1",
  };
}

function withAmbientSetHas<T>(replacement: (this: Set<unknown>, value: unknown) => boolean, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Set.prototype, "has");
  assert.ok(original);
  try {
    Object.defineProperty(Set.prototype, "has", {
      configurable: true, writable: true, value: replacement,
    });
    return run();
  } finally {
    Object.defineProperty(Set.prototype, "has", original);
  }
}

test("Outcome Ledger denies unknown fields under ambient Set.has allowlist forgery", () => {
  const baseline = settled();
  const expectedDigest = outcomeLearningLedgerDigest(baseline);
  const unknown = { ...baseline, publicUrl: "https://example.invalid/synthetic" };

  // The pre-fix module-owned allowlist Set has more members than the temporary
  // duplicate-detection Set. A size-selective hook previously admitted the
  // unknown field without making the one-element evidence list invalid.
  const observed = withAmbientSetHas(function () { return this.size > 5; }, () => {
    const verdict = validateOutcomeLearningLedgerRecord(unknown);
    const append = classifyOutcomeLedgerAppend(undefined, unknown);
    let digestDenied = false;
    try { outcomeLearningLedgerDigest(unknown); } catch (error) { digestDenied = error instanceof TypeError; }
    return { verdict, append, digestDenied, normalDigest: outcomeLearningLedgerDigest(baseline) };
  });

  assert.equal(observed.verdict.valid, false);
  assert.ok(observed.verdict.errors.includes("unknown field is not allowed: publicUrl"));
  assert.equal(observed.append, "REJECTED_INVALID");
  assert.equal(observed.digestDenied, true);
  assert.equal(observed.normalDigest, expectedDigest);
});

test("Outcome Ledger denies duplicate evidence digests under ambient Set.has denial", () => {
  const baseline = settled();
  const expectedDigest = outcomeLearningLedgerDigest(baseline);
  const duplicate = { ...baseline, sourceEvidenceDigests: ["a".repeat(64), "a".repeat(64)] };

  // A synthetic always-false Set.has previously erased duplicate evidence
  // detection while leaving the canonical digest input unchanged.
  const observed = withAmbientSetHas(function () { return false; }, () => {
    const verdict = validateOutcomeLearningLedgerRecord(duplicate);
    const append = classifyOutcomeLedgerAppend(undefined, duplicate);
    let digestDenied = false;
    try { outcomeLearningLedgerDigest(duplicate); } catch (error) { digestDenied = error instanceof TypeError; }
    return { verdict, append, digestDenied, normalDigest: outcomeLearningLedgerDigest(baseline) };
  });

  assert.equal(observed.verdict.valid, false);
  assert.ok(observed.verdict.errors.includes("sourceEvidenceDigests must not contain duplicates"));
  assert.equal(observed.append, "REJECTED_INVALID");
  assert.equal(observed.digestDenied, true);
  assert.equal(observed.normalDigest, expectedDigest);
});
