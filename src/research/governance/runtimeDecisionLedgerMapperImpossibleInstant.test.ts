import assert from "node:assert/strict";
import test from "node:test";
import {
  mapDecisionHistoryRowToRuntimeLedger,
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
};

function row(overrides: Partial<DecisionHistoryShadowRow> = {}): DecisionHistoryShadowRow {
  return {
    id: 1001,
    race_id: "20260805-08-08",
    date: "2026-08-05",
    venue: "test",
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
    decision_reasons: "[]",
    feature_adjustment: 0,
    feature_adjustment_breakdown: "{}",
    close_at: "14:32",
    program_imported_at: "2026-08-05 04:00:00",
    ...overrides,
  };
}

test("mapper does not normalize impossible source calendar instants", () => {
  for (const [overrides, reason] of [
    [{ created_at: "2026-02-30 05:26:30" }, "decision_at_timezone_or_format_unresolved"],
    [{ fetched_at: "2026-02-30T14:26:10+09:00" }, "odds_observed_at_timezone_or_format_unresolved"],
    [{ program_imported_at: "2026-02-30 04:00:00" }, "program_import_time_missing_or_invalid"],
    [{ date: "2026-02-30" }, "scheduled_close_missing_or_invalid"],
    [{ close_at: "24:00" }, "scheduled_close_missing_or_invalid"],
  ] as const) {
    const result = mapDecisionHistoryRowToRuntimeLedger(row(overrides), context);
    assert.equal(result.status, "unresolved");
    if (result.status === "unresolved") assert.ok(result.reasons.includes(reason));
  }
});
