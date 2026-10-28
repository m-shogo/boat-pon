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

test("shadow mapper preserves distinct source-row digests under no-op Array.map/sort", () => {
  // Only a source-audit field differs; mapped decision fields remain identical.
  // Collapsing sourceRowDigest would incorrectly hide this source change.
  const first = row({ decision_reasons: null, feature_adjustment_breakdown: '{"motor":0.012}' });
  const second = row({ decision_reasons: null, feature_adjustment_breakdown: '{"motor":0.013}' });
  const baselineFirst = mapDecisionHistoryRowToRuntimeLedger(first, context);
  const baselineSecond = mapDecisionHistoryRowToRuntimeLedger(second, context);
  assert.equal(baselineFirst.status, "mapped");
  assert.equal(baselineSecond.status, "mapped");
  if (baselineFirst.status !== "mapped" || baselineSecond.status !== "mapped") return;
  assert.notEqual(baselineFirst.record.sourceRowDigest, baselineSecond.record.sourceRowDigest);
  assert.notEqual(baselineFirst.ledgerDigest, baselineSecond.ledgerDigest);

  const originalMap = Object.getOwnPropertyDescriptor(Array.prototype, "map")!;
  const originalSort = Object.getOwnPropertyDescriptor(Array.prototype, "sort")!;
  let observed: [ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger>, ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger>] | undefined;
  try {
    Object.defineProperty(Array.prototype, "map", {
      configurable: true, writable: true, value() { return []; },
    });
    Object.defineProperty(Array.prototype, "sort", {
      configurable: true, writable: true, value() { return this; },
    });
    observed = [
      mapDecisionHistoryRowToRuntimeLedger(first, context),
      mapDecisionHistoryRowToRuntimeLedger(second, context),
    ];
  } finally {
    Object.defineProperty(Array.prototype, "map", originalMap);
    Object.defineProperty(Array.prototype, "sort", originalSort);
  }

  assert.equal(observed?.[0].status, "mapped");
  assert.equal(observed?.[1].status, "mapped");
  if (observed?.[0].status !== "mapped" || observed[1].status !== "mapped") return;
  assert.equal(observed[0].record.sourceRowDigest, baselineFirst.record.sourceRowDigest);
  assert.equal(observed[1].record.sourceRowDigest, baselineSecond.record.sourceRowDigest);
  assert.equal(observed[0].ledgerDigest, baselineFirst.ledgerDigest);
  assert.equal(observed[1].ledgerDigest, baselineSecond.ledgerDigest);
});

test("shadow mapper preserves source/PIT denials and conflict status under no-op Array.push", () => {
  // Synthetic-only: never access operational evidence or production persistence.
  const invalidRace = row({ race_no: 0 });
  const lateProgram = row({ program_imported_at: "2026-08-05 05:30:00" });
  const conflicting = [row(), row({ current_odds: 7.1 })];
  const baseline = mapDecisionHistoryRowToRuntimeLedger(row(), context);
  assert.equal(baseline.status, "mapped");

  const originalPush = Object.getOwnPropertyDescriptor(Array.prototype, "push")!;
  let invalid: ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger> | undefined;
  let late: ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger> | undefined;
  let conflict: ReturnType<typeof reconcileDecisionHistoryRowsToRuntimeLedger> | undefined;
  let valid: ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger> | undefined;
  try {
    Object.defineProperty(Array.prototype, "push", {
      configurable: true, writable: true, value() { return this.length; },
    });
    invalid = mapDecisionHistoryRowToRuntimeLedger(invalidRace, context);
    late = mapDecisionHistoryRowToRuntimeLedger(lateProgram, context);
    conflict = reconcileDecisionHistoryRowsToRuntimeLedger(conflicting, context);
    valid = mapDecisionHistoryRowToRuntimeLedger(row(), context);
  } finally {
    Object.defineProperty(Array.prototype, "push", originalPush);
  }

  assert.equal(invalid?.status, "rejected");
  if (invalid?.status === "rejected") assert.ok(invalid.reasons.includes("race_no is invalid"));
  assert.equal(late?.status, "unresolved");
  if (late?.status === "unresolved") {
    assert.ok(late.reasons.includes("close_time_not_proven_visible_at_decision"));
  }
  assert.equal(conflict?.status, "FAILED");
  assert.equal(conflict?.conflictCount, 1);
  assert.equal(conflict?.conflicts.length, 1);
  assert.equal(valid?.status, "mapped");
  if (valid?.status === "mapped" && baseline.status === "mapped") {
    assert.equal(valid.ledgerDigest, baseline.ledgerDigest);
  }
});

test("shadow mapper preserves reasons, membership and sorted digest under no-op array helpers", () => {
  const sourceRows = [
    row({ id: 1002, decision_reasons: null }),
    row({ id: 1001, decision_reasons: null }),
  ];
  const baseline = reconcileDecisionHistoryRowsToRuntimeLedger(sourceRows, context);
  const baselineValid = mapDecisionHistoryRowToRuntimeLedger(row({ decision_reasons: '["synthetic reason"]' }), context);
  const baselineMalformed = mapDecisionHistoryRowToRuntimeLedger(row({ decision_reasons: "[5]" }), context);
  assert.equal(baseline.status, "PASS");
  assert.equal(baseline.mappedUnique, 2);
  assert.equal(baselineValid.status, "mapped");
  assert.equal(baselineMalformed.status, "mapped");

  const originalSome = Object.getOwnPropertyDescriptor(Array.prototype, "some")!;
  const originalMap = Object.getOwnPropertyDescriptor(Array.prototype, "map")!;
  const originalSort = Object.getOwnPropertyDescriptor(Array.prototype, "sort")!;
  let observed: ReturnType<typeof reconcileDecisionHistoryRowsToRuntimeLedger> | undefined;
  let valid: ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger> | undefined;
  let malformed: ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger> | undefined;
  try {
    Object.defineProperty(Array.prototype, "some", {
      configurable: true, writable: true, value() { return false; },
    });
    Object.defineProperty(Array.prototype, "map", {
      configurable: true, writable: true, value() { return []; },
    });
    Object.defineProperty(Array.prototype, "sort", {
      configurable: true, writable: true, value() { return this; },
    });
    observed = reconcileDecisionHistoryRowsToRuntimeLedger(sourceRows, context);
    valid = mapDecisionHistoryRowToRuntimeLedger(row({ decision_reasons: '["synthetic reason"]' }), context);
    malformed = mapDecisionHistoryRowToRuntimeLedger(row({ decision_reasons: "[5]" }), context);
  } finally {
    Object.defineProperty(Array.prototype, "sort", originalSort);
    Object.defineProperty(Array.prototype, "map", originalMap);
    Object.defineProperty(Array.prototype, "some", originalSome);
  }

  assert.equal(observed?.status, "PASS");
  assert.equal(observed?.mappedUnique, 2);
  assert.equal(observed?.recordsDigest, baseline.recordsDigest);
  assert.deepEqual(observed?.records.map((record) => record.recordId), baseline.records.map((record) => record.recordId));
  assert.equal(valid?.status, "mapped");
  assert.equal(malformed?.status, "mapped");
  if (valid?.status === "mapped" && baselineValid.status === "mapped") {
    assert.deepEqual(valid.record.reasons, baselineValid.record.reasons);
    assert.equal(valid.ledgerDigest, baselineValid.ledgerDigest);
  }
  if (malformed?.status === "mapped" && baselineMalformed.status === "mapped") {
    assert.deepEqual(malformed.record.warnings, baselineMalformed.record.warnings);
    assert.ok(malformed.record.warnings.includes("decision_reasons_not_string_array"));
  }
});

test("shadow mapper does not convert unknown -00:00 source offsets into proven PIT evidence", () => {
  const cases: Array<{
    overrides: Partial<DecisionHistoryShadowRow>;
    reason: string;
  }> = [
    { overrides: { created_at: "2026-08-05T05:26:30-00:00" }, reason: "decision_at_timezone_or_format_unresolved" },
    { overrides: { fetched_at: "2026-08-05T05:26:10-00:00" }, reason: "odds_observed_at_timezone_or_format_unresolved" },
    { overrides: { program_imported_at: "2026-08-05T04:00:00-00:00" }, reason: "program_import_time_missing_or_invalid" },
    { overrides: { close_at: "2026-08-05T05:32:00-00:00" }, reason: "scheduled_close_missing_or_invalid" },
  ];
  for (const candidate of cases) {
    const result = mapDecisionHistoryRowToRuntimeLedger(row(candidate.overrides), context);
    assert.equal(result.status, "unresolved", candidate.reason);
    if (result.status === "unresolved") assert.ok(result.reasons.includes(candidate.reason));
  }

  // +00:00 is a known UTC offset and must retain the valid mapping path.
  const known = mapDecisionHistoryRowToRuntimeLedger(row({
    created_at: "2026-08-05T05:26:30+00:00",
    fetched_at: "2026-08-05T05:26:10+00:00",
    program_imported_at: "2026-08-05T04:00:00+00:00",
    close_at: "2026-08-05T05:32:00+00:00",
  }), context);
  assert.equal(known.status, "mapped");
  if (known.status === "mapped") {
    assert.equal(known.record.decisionAt, "2026-08-05T05:26:30.000Z");
    assert.equal(known.record.scheduledCloseAtSeen, "2026-08-05T05:32:00.000Z");
  }
});
