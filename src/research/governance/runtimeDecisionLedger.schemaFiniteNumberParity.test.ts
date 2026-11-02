import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
  validateRuntimeDecisionLedgerRecord,
  type RuntimeDecisionLedgerRecord,
} from "./runtimeDecisionLedger";

// Synthetic K1 research metadata only. No real odds, Current BUY or production connection.
type NumericRule = { type: string; exclusiveMinimum?: number; minimum?: number; maximum?: number };
type NullableRule = { oneOf: Array<NumericRule | { type: "null" }> };
const schema = JSON.parse(readFileSync(
  new URL("../../../config/research-governance/runtime-decision-ledger.schema.json", import.meta.url),
  "utf8",
)) as {
  properties: Record<string, NullableRule>;
  allOf: Array<{ then?: { properties?: Record<string, NumericRule> } }>;
};
const fields = ["currentOdds", "requiredOdds", "expectedValue"] as const;

function admits(rule: NumericRule, value: number): boolean {
  return rule.type === "number"
    && (rule.minimum === undefined || value >= rule.minimum)
    && (rule.exclusiveMinimum === undefined || value > rule.exclusiveMinimum)
    && (rule.maximum === undefined || value <= rule.maximum);
}

function fixture(): RuntimeDecisionLedgerRecord {
  return {
    schemaVersion: RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
    recordId: "runtime:synthetic:finite-number",
    decisionId: "decision:synthetic",
    canonicalRaceId: "race:synthetic",
    sourceDecisionHistoryId: null,
    decisionSystem: "research_fixture",
    strategyVersion: "synthetic-v1",
    modelVersion: "synthetic-v1",
    featureVersion: "synthetic-v1",
    manifestId: "manifest:synthetic",
    cohortId: "cohort:synthetic",
    evaluationMode: "shadow_forward",
    ticketType: "trifecta",
    selection: "1-2-3",
    decision: "WATCH",
    decisionAt: "2026-08-05T05:26:30Z",
    oddsObservedAt: null,
    scheduledCloseAtSeen: "2026-08-05T05:32:00Z",
    currentOdds: null,
    requiredOdds: 5.2,
    estimatedHitRate: 0.2,
    rawEstimatedHitRate: null,
    expectedValue: null,
    recommendedStakeYen: 0,
    sampleSize: 1,
    reasons: ["synthetic"],
    warnings: [],
    dataCompleteness: "partial",
    notificationEligible: false,
    notificationDedupeKey: null,
    sourceRowDigest: "a".repeat(64),
  };
}

function buyFixture(): RuntimeDecisionLedgerRecord {
  return {
    ...fixture(),
    decision: "BUY",
    currentOdds: 6.4,
    requiredOdds: 5.2,
    expectedValue: 1.1,
    oddsObservedAt: "2026-08-05T05:26:00Z",
    recommendedStakeYen: 100,
    dataCompleteness: "complete",
  };
}

test("Runtime Ledger schema bounds nullable and BUY number rules to finite JS values", () => {
  const overflow = JSON.parse("1e400") as number;
  const underflow = JSON.parse("-1e400") as number;
  assert.equal(overflow, Infinity);
  assert.equal(underflow, -Infinity);
  for (const field of fields) {
    const nullable = schema.properties[field]?.oneOf.find((rule) => rule.type === "number") as NumericRule | undefined;
    const buy = schema.allOf[0]?.then?.properties?.[field];
    assert.ok(nullable, field + " nullable rule");
    assert.ok(buy, field + " BUY rule");
    for (const rule of [nullable, buy]) {
      assert.equal(rule.maximum, Number.MAX_VALUE, field);
      if (field === "expectedValue") {
        assert.equal(rule.minimum, -Number.MAX_VALUE);
        assert.equal(admits(rule, -Number.MAX_VALUE), true);
        assert.equal(admits(rule, underflow), false);
      } else {
        assert.equal(rule.exclusiveMinimum, 0);
        assert.equal(admits(rule, 0), false);
      }
      assert.equal(admits(rule, Number.MAX_VALUE), true);
      assert.equal(admits(rule, overflow), false);
    }
  }
});

test("Runtime Ledger accepts finite boundaries and rejects exponent overflow for WATCH and BUY", () => {
  for (const make of [fixture, buyFixture]) {
    const good = make();
    good.currentOdds = Number.MAX_VALUE;
    good.requiredOdds = Number.MAX_VALUE;
    good.expectedValue = -Number.MAX_VALUE;
    const valid = validateRuntimeDecisionLedgerRecord(good);
    assert.equal(valid.valid, true, valid.errors.join("; "));
    for (const field of fields) {
      for (const overflow of [JSON.parse("1e400") as number, JSON.parse("-1e400") as number]) {
        const record = make();
        record[field] = overflow;
        assert.equal(validateRuntimeDecisionLedgerRecord(record).valid, false, field + ":" + String(overflow));
      }
    }
  }
  // Schema-only acceptance cannot authorize real decision, settlement or scoring evidence.
});
