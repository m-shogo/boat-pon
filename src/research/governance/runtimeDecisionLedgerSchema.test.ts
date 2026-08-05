import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RUNTIME_DECISION_LEDGER_SCHEMA_VERSION, type RuntimeDecisionLedgerRecord } from "./runtimeDecisionLedger";

const schemaPath = "config/research-governance/runtime-decision-ledger.schema.json";

function fixture(): RuntimeDecisionLedgerRecord {
  return {
    schemaVersion: RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
    recordId: "runtime-decision:test:1",
    decisionId: "decision-test-1",
    canonicalRaceId: "2026-08-05-08-08",
    sourceDecisionHistoryId: null,
    decisionSystem: "market_intelligence",
    strategyVersion: "strategy-test-v1",
    modelVersion: "model-test-v1",
    featureVersion: "feature-test-v1",
    manifestId: "manifest-test-1",
    cohortId: "cohort-test-1",
    evaluationMode: "shadow_forward",
    ticketType: "trifecta",
    selection: "1-3-4",
    decision: "WATCH",
    decisionAt: "2026-08-05T05:26:30.000Z",
    oddsObservedAt: null,
    scheduledCloseAtSeen: "2026-08-05T05:32:00.000Z",
    currentOdds: null,
    requiredOdds: 5.2,
    estimatedHitRate: 0.231,
    rawEstimatedHitRate: null,
    expectedValue: null,
    recommendedStakeYen: 0,
    sampleSize: 184,
    reasons: ["shadow candidate"],
    warnings: ["odds unavailable"],
    dataCompleteness: "partial",
    notificationEligible: false,
    notificationDedupeKey: null,
    sourceRowDigest: "b".repeat(64),
  };
}

test("Runtime Decision Ledger JSON Schema matches the TypeScript contract surface", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown> & { schemaVersion: { const: string } };
  };
  const recordFields = Object.keys(fixture()).sort();

  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schemaVersion.const, RUNTIME_DECISION_LEDGER_SCHEMA_VERSION);
  assert.deepEqual([...schema.required].sort(), recordFields);
  assert.deepEqual(Object.keys(schema.properties).sort(), recordFields);
});
