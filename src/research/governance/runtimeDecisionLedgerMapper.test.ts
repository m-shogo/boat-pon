import assert from "node:assert/strict";
import test from "node:test";
import {
  mapDecisionHistoryRowToRuntimeLedger,
  reconcileDecisionHistoryRowsToRuntimeLedger,
  type DecisionHistoryShadowRow,
  type RuntimeDecisionLedgerMappingContext,
} from "./runtimeDecisionLedgerMapper";

const context: RuntimeDecisionLedgerMappingContext = {
  decisionSystem: "current-buy-shadow",
  strategyVersion: "legacy-t5-v1",
  featureVersion: "decision-audit-v1",
  manifestId: "manifest-shadow-20260805",
  cohortId: "paper-live-20260805",
  evaluationMode: "formal_forward",
  lineNotificationEligible: true,
};

function row(overrides: Partial<DecisionHistoryShadowRow> = {}): DecisionHistoryShadowRow {
  return {
    id: 1001,
    race_id: "20260805-08-08",
    date: "2026-08-05",
    venue: "蒲郡",
    race_no: 8,
    bet_type: "trifecta",
    selection: "1-3-4",
    estimated_hit_rate: 0.231,
    raw_estimated_hit_rate: 0.247,
    required_odds: 5.2,
    current_odds: 6.4,
    ev: 1.48,
    decision: "BUY",
    recommended_stake_yen: 100,
    sample_size: 842,
    model_version: "v4-conservative",
    run_kind: "paper-live",
    source: "official-live",
    fetched_at: "2026-08-05T14:26:10+09:00",
    created_at: "2026-08-05 05:26:30",
    decision_reasons: "[\"EV threshold passed\"]",
    feature_adjustment: 0.012,
    feature_adjustment_breakdown: "{\"motor\":0.012}",
    close_at: "14:32",
    program_imported_at: "2026-08-05 04:00:00",
    ...overrides,
  };
}

test("maps deterministically with JST close and UTC SQLite timestamps", () => {
  const a = mapDecisionHistoryRowToRuntimeLedger(row(), context);
  const b = mapDecisionHistoryRowToRuntimeLedger(row(), context);
  assert.equal(a.status, "mapped");
  assert.equal(b.status, "mapped");
  if (a.status !== "mapped" || b.status !== "mapped") return;
  assert.equal(a.record.decisionAt, "2026-08-05T05:26:30.000Z");
  assert.equal(a.record.oddsObservedAt, "2026-08-05T05:26:10.000Z");
  assert.equal(a.record.scheduledCloseAtSeen, "2026-08-05T05:32:00.000Z");
  assert.equal(a.record.notificationDedupeKey, "line:20260805-08-08");
  assert.equal(a.ledgerDigest, b.ledgerDigest);
});

test("does not claim close-time visibility when program import is later", () => {
  const result = mapDecisionHistoryRowToRuntimeLedger(row({ program_imported_at: "2026-08-05 05:30:00" }), context);
  assert.equal(result.status, "unresolved");
  if (result.status === "unresolved") assert.ok(result.reasons.includes("close_time_not_proven_visible_at_decision"));
});

test("flags a source row whose fetched time is after created time", () => {
  const result = mapDecisionHistoryRowToRuntimeLedger(row({ fetched_at: "2026-08-05T14:27:00+09:00" }), context);
  assert.equal(result.status, "unresolved");
  if (result.status === "unresolved") assert.ok(result.reasons.includes("source_row_update_or_odds_observation_after_created_at"));
});

test("rejects incomplete BUY evidence", () => {
  const result = mapDecisionHistoryRowToRuntimeLedger(row({ current_odds: null, ev: null, recommended_stake_yen: 0 }), context);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.ok(result.reasons.includes("BUY requires currentOdds"));
    assert.ok(result.reasons.includes("BUY requires expectedValue"));
  }
});

test("WATCH can remain partial and is never notification eligible", () => {
  const result = mapDecisionHistoryRowToRuntimeLedger(row({ decision: "WATCH", current_odds: null, ev: null, recommended_stake_yen: 0 }), context);
  assert.equal(result.status, "mapped");
  if (result.status !== "mapped") return;
  assert.equal(result.record.dataCompleteness, "partial");
  assert.equal(result.record.notificationEligible, false);
  assert.equal(result.record.oddsObservedAt, null);
});

test("reconciliation deduplicates exact rows and fails conflicting identity", () => {
  const exact = reconcileDecisionHistoryRowsToRuntimeLedger([row(), row()], context);
  assert.equal(exact.status, "PASS");
  assert.equal(exact.mappedUnique, 1);
  assert.equal(exact.exactDuplicates, 1);

  const conflict = reconcileDecisionHistoryRowsToRuntimeLedger([row(), row({ current_odds: 7.1 })], context);
  assert.equal(conflict.status, "FAILED");
  assert.equal(conflict.conflictCount, 1);
});
