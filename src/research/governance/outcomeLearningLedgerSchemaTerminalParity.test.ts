import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION as V,
  classifyOutcomeLedgerAppend,
  outcomeLearningLedgerDigest,
  validateOutcomeLearningLedgerRecord,
  type OutcomeLearningLedgerRecord,
} from "./outcomeLearningLedger";

// Schema-only Python Draft 2020-12 uses re.search: a final $ accepts a trailing LF.
// ECMAScript runtime rejects it. This research fixture must stay cross-engine strict.
const schema = JSON.parse(readFileSync("config/research-governance/outcome-learning-ledger.schema.json", "utf8")) as {
  properties: {
    settledAt: { pattern: string };
    sourceEvidenceDigests: { items: { pattern: string } };
  };
};
const exactEnd = String.raw`(?![\\s\\S])`;
function fixture(): OutcomeLearningLedgerRecord {
  return {
    schemaVersion: V,
    outcomeRecordId: "fixture-outcome",
    decisionRecordId: "fixture-decision-record",
    decisionId: "fixture-decision",
    canonicalRaceId: "fixture-race",
    ticketType: "trifecta",
    selection: "1-3-4",
    settlementId: "fixture-settlement",
    settledAt: "2026-08-05T06:00:00Z",
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
const terminalSuffixes = ["\\n", "\\r\\n", "\\u2028", "\\u2029"];

test("Outcome Ledger schema-only settlement timestamp requires a portable exact terminal", () => {
  const pattern = schema.properties.settledAt.pattern;
  assert.equal(pattern.endsWith(exactEnd), true);
  const rule: RegExp = new RegExp(pattern, "u");
  for (const valid of ["2026-08-05T06:00:00Z", "2026-08-05T15:00:00+09:00"]) {
    assert.equal(rule.test(valid), true, valid);
    assert.equal(validateOutcomeLearningLedgerRecord({ ...fixture(), settledAt: valid }).valid, true, valid);
    for (const escaped of terminalSuffixes) {
      const suffix = JSON.parse('"' + escaped + '"') as string;
      const row: OutcomeLearningLedgerRecord = { ...fixture(), settledAt: valid + suffix };
      assert.equal(rule.test(row.settledAt), false, escaped);
      assert.equal(validateOutcomeLearningLedgerRecord(row).valid, false, escaped);
      assert.throws(() => outcomeLearningLedgerDigest(row), TypeError);
      assert.equal(classifyOutcomeLedgerAppend(undefined, row), "REJECTED_INVALID");
    }
  }
});

test("Outcome Ledger schema-only SHA-256 digest requires a portable exact terminal", () => {
  const pattern = schema.properties.sourceEvidenceDigests.items.pattern;
  assert.equal(pattern.endsWith(exactEnd), true);
  const rule: RegExp = new RegExp(pattern, "u");
  const valid = "a".repeat(64);
  assert.equal(rule.test(valid), true);
  assert.equal(validateOutcomeLearningLedgerRecord(fixture()).valid, true);
  for (const escaped of terminalSuffixes) {
    const suffix = JSON.parse('"' + escaped + '"') as string;
    const row: OutcomeLearningLedgerRecord = { ...fixture(), sourceEvidenceDigests: [valid + suffix] };
    assert.equal(rule.test(row.sourceEvidenceDigests[0]!), false, escaped);
    assert.equal(validateOutcomeLearningLedgerRecord(row).valid, false, escaped);
    assert.throws(() => outcomeLearningLedgerDigest(row), TypeError);
    assert.equal(classifyOutcomeLedgerAppend(undefined, row), "REJECTED_INVALID");
  }
});
