import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION as V,
  validateOutcomeLearningLedgerRecord,
  type OutcomeLearningLedgerRecord,
} from "./outcomeLearningLedger";

const schema = JSON.parse(readFileSync("config/research-governance/outcome-learning-ledger.schema.json", "utf8")) as {
  properties: Record<string, { type?: string; minLength?: number; pattern?: string; oneOf?: Array<{ type: string; minLength?: number; pattern?: string }> }>;
};
const identityFields = [
  "outcomeRecordId", "decisionRecordId", "decisionId", "canonicalRaceId",
  "ticketType", "selection", "settlementId", "provenanceVersion",
] as const;
const portablePattern = String.raw`[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]`;
const whitespace = [
  ...Array.from({ length: 5 }, (_, i) => i + 9),
  0x20, 0xA0, 0x1680,
  ...Array.from({ length: 11 }, (_, i) => i + 0x2000),
  0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
];
const probes = [
  "", " ", "\t\n", "\uFEFF", "\u0085", "\uFEFF\u0085",
  "\u0085\uFEFF", "\uFEFFx\uFEFF",
  ...whitespace.map((cp) => String.fromCodePoint(cp)),
  ...[0x85, 0x180E, 0x200B, 0x61, 0x30, 0x1F600].map((cp) => String.fromCodePoint(cp)),
];
function fixture(): OutcomeLearningLedgerRecord {
  return {
    schemaVersion: V,
    outcomeRecordId: "fixture-outcome-1",
    decisionRecordId: "fixture-decision-record-1",
    decisionId: "fixture-decision-1",
    canonicalRaceId: "fixture-race-1",
    ticketType: "trifecta",
    selection: "1-3-4",
    settlementId: "fixture-settlement-1",
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
test("Outcome Ledger schema nonblank identity constraints match ECMAScript trim", () => {
  for (const field of identityFields) {
    const rule = schema.properties[field];
    assert.equal(rule.type, "string", field);
    assert.equal(rule.minLength, 1, field);
    assert.equal(rule.pattern, portablePattern, field);
    const regex = new RegExp(rule.pattern, "u");
    for (const value of probes) {
      const expected = value.trim().length > 0;
      assert.equal(regex.test(value), expected, `${field}: ${JSON.stringify(value)}`);
      assert.equal(validateOutcomeLearningLedgerRecord({ ...fixture(), [field]: value }).valid, expected, `${field}: ${JSON.stringify(value)}`);
    }
  }
});
test("Outcome Ledger schema refundReason string constraint matches runtime trim", () => {
  const stringRule = schema.properties.refundReason.oneOf?.find((rule) => rule.type === "string");
  assert.ok(stringRule);
  assert.equal(stringRule.minLength, 1);
  assert.equal(stringRule.pattern, portablePattern);
  const regex = new RegExp(stringRule.pattern, "u");
  for (const value of probes) {
    const expected = value.trim().length > 0;
    const row: OutcomeLearningLedgerRecord = {
      ...fixture(), disposition: "REFUNDED", evaluable: false,
      payoutYen: 0, refundYen: 100, refundReason: value,
    };
    assert.equal(regex.test(value), expected, JSON.stringify(value));
    assert.equal(validateOutcomeLearningLedgerRecord(row).valid, expected, JSON.stringify(value));
  }
  assert.equal("\uFEFF".trim().length, 0);
  assert.equal("\u0085".trim().length, 1);
});
