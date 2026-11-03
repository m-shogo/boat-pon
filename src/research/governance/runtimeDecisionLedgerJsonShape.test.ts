import assert from "node:assert/strict";
import test from "node:test";
import { runtimeDecisionLedgerDigest, validateRuntimeDecisionLedgerRecord, RUNTIME_DECISION_LEDGER_SCHEMA_VERSION, type RuntimeDecisionLedgerRecord } from "./runtimeDecisionLedger";

const valid = (): RuntimeDecisionLedgerRecord => ({
  schemaVersion: RUNTIME_DECISION_LEDGER_SCHEMA_VERSION,
  recordId: "synthetic:shape-guard", decisionId: "synthetic-decision", canonicalRaceId: "synthetic-race",
  sourceDecisionHistoryId: null, decisionSystem: "research-only", strategyVersion: "v1", modelVersion: "v1", featureVersion: "v1",
  manifestId: "synthetic-manifest", cohortId: "synthetic-cohort", evaluationMode: "validation", ticketType: "trifecta",
  selection: "1-2-3", decision: "SKIP", decisionAt: "2026-10-19T00:00:00Z", oddsObservedAt: null,
  scheduledCloseAtSeen: "2026-10-19T00:05:00Z", currentOdds: null, requiredOdds: null,
  estimatedHitRate: null, rawEstimatedHitRate: null, expectedValue: null, recommendedStakeYen: 0, sampleSize: 0,
  reasons: [], warnings: [], dataCompleteness: "blocked", notificationEligible: false, notificationDedupeKey: null,
  sourceRowDigest: "a".repeat(64),
});
const reject = (record: RuntimeDecisionLedgerRecord) => {
  assert.equal(validateRuntimeDecisionLedgerRecord(record).valid, false);
  assert.throws(() => runtimeDecisionLedgerDigest(record), TypeError);
};
test("K1 JSON boundary accepts normal dense and empty string arrays", () => {
  const record = valid(); record.reasons = ["synthetic reason", "another reason"];
  assert.equal(validateRuntimeDecisionLedgerRecord(record).valid, true);
  assert.match(runtimeDecisionLedgerDigest(record), /^[0-9a-f]{64}$/);
  assert.equal(validateRuntimeDecisionLedgerRecord(valid()).valid, true);
});
test("K1 JSON boundary rejects sparse arrays before serialization", () => {
  for (const field of ["reasons", "warnings"] as const) {
    const record = valid(); record[field] = Array(1) as string[];
    assert.equal(JSON.stringify(record[field]), "[null]"); reject(record);
    const mixed = valid(); mixed[field] = ["safe", , "safe"] as string[]; reject(mixed);
  }
});
test("K1 JSON boundary rejects indexed getters and extra array keys", () => {
  const getter = valid(); const array: string[] = ["safe"];
  Object.defineProperty(array, "0", { enumerable: true, get: () => { throw Error("getter must not run"); } });
  getter.reasons = array; reject(getter);
  const extra = valid(); const array2: string[] = ["safe"];
  Object.defineProperty(array2, "extra", { value: "hidden", enumerable: true });
  extra.warnings = array2; reject(extra);
});
test("K1 JSON boundary rejects non-enumerable, inherited and accessor record fields", () => {
  const hidden = valid();
  Object.defineProperty(hidden, "recordId", { value: "synthetic:shape-guard", enumerable: false }); reject(hidden);
  const inherited = Object.assign(Object.create({ recordId: "synthetic:shape-guard" }), valid());
  delete inherited.recordId; reject(inherited);
  const getter = valid();
  Object.defineProperty(getter, "recordId", { enumerable: true, get: () => { throw Error("getter must not run"); } }); reject(getter);
});
test("K1 JSON boundary rejects symbol and toJSON hooks", () => {
  const symbol = valid(); (symbol as any)[Symbol("private")] = "hidden"; reject(symbol);
  const hook = valid(); (hook as any).toJSON = () => ({ ...valid(), recordId: "different" }); reject(hook);
  const arrayHook = valid(); (arrayHook.reasons as any).toJSON = () => ["mutated"]; reject(arrayHook);
});
