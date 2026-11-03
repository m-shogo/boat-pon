import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION as V,
  validateOutcomeLearningLedgerRecord,
  outcomeLearningLedgerDigest,
  classifyOutcomeLedgerAppend,
  type OutcomeLearningLedgerRecord,
} from "./outcomeLearningLedger";

const fixture = (settledAt: string): OutcomeLearningLedgerRecord => ({
  schemaVersion: V,
  outcomeRecordId: "fixture-outcome-1",
  decisionRecordId: "fixture-decision-1",
  decisionId: "fixture-decision",
  canonicalRaceId: "fixture-race",
  ticketType: "trifecta",
  selection: "1-3-4",
  settlementId: "fixture-settlement",
  settledAt,
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
});

test("Outcome Ledger rejects unknown offsets and year zero at runtime and schema admission", () => {
  const schema = JSON.parse(readFileSync("config/research-governance/outcome-learning-ledger.schema.json", "utf8")) as {
    properties: { settledAt: { format: string; pattern: string } };
  };
  assert.equal(schema.properties.settledAt.format, "date-time");
  const schemaInstant = new RegExp(schema.properties.settledAt.pattern, "u");
  for (const instant of [
    "0000-08-05T06:00:00Z",
    "2026-08-05T06:00:00-00:00",
    "2026-08-05T06:00:00.123456-00:00",
  ]) {
    assert.equal(Number.isFinite(Date.parse(instant)), true, instant);
    assert.equal(schemaInstant.test(instant), false, instant);
    const row = fixture(instant);
    assert.equal(validateOutcomeLearningLedgerRecord(row).valid, false, instant);
    assert.throws(() => outcomeLearningLedgerDigest(row), TypeError);
    assert.equal(classifyOutcomeLedgerAppend(undefined, row), "REJECTED_INVALID");
  }
  for (const instant of [
    "2026-08-05T06:00:00Z",
    "2026-08-05T06:00:00+00:00",
    "2026-08-05T15:00:00+09:00",
    "2024-02-29T23:59:59.123456-05:00",
  ]) {
    assert.equal(schemaInstant.test(instant), true, instant);
    const row = fixture(instant);
    assert.equal(validateOutcomeLearningLedgerRecord(row).valid, true, instant);
    assert.match(outcomeLearningLedgerDigest(row), /^[0-9a-f]{64}$/u);
  }
});
