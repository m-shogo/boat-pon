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

test("shadow mapper preserves submillisecond PIT chronology before UTC canonicalization", () => {
  const decision = "2026-08-05T05:26:30.0001000Z";
  const later = "2026-08-05T05:26:30.0001001Z";
  const earlier = "2026-08-05T05:26:30.0000999Z";
  const oddsAfter = mapDecisionHistoryRowToRuntimeLedger(row({
    created_at: decision,
    fetched_at: later,
  }), context);
  assert.equal(oddsAfter.status, "unresolved");
  if (oddsAfter.status === "unresolved") {
    assert.ok(oddsAfter.reasons.includes("source_row_update_or_odds_observation_after_created_at"));
  }

  const programAfter = mapDecisionHistoryRowToRuntimeLedger(row({
    created_at: decision,
    fetched_at: earlier,
    program_imported_at: later,
  }), context);
  assert.equal(programAfter.status, "unresolved");
  if (programAfter.status === "unresolved") {
    assert.ok(programAfter.reasons.includes("close_time_not_proven_visible_at_decision"));
  }

  const valid = mapDecisionHistoryRowToRuntimeLedger(row({
    created_at: decision,
    fetched_at: "2026-08-05T14:26:30.0000999+09:00",
    program_imported_at: "2026-08-05 05:26:30.0000998",
    close_at: "2026-08-05T05:32:00.0001001Z",
  }), context);
  assert.equal(valid.status, "mapped");
  if (valid.status === "mapped") {
    assert.equal(valid.record.decisionAt, decision);
    assert.equal(valid.record.oddsObservedAt, earlier);
    assert.equal(valid.record.scheduledCloseAtSeen, "2026-08-05T05:32:00.0001001Z");
  }
});

test("shadow mapper retains source membership and denials under an empty ambient array iterator", () => {
  const sourceRows = [
    row({ id: 1002, decision_reasons: null }),
    row({ id: 1001, decision_reasons: null }),
  ];
  const baseline = reconcileDecisionHistoryRowsToRuntimeLedger(sourceRows, context);
  const baselineWarning = mapDecisionHistoryRowToRuntimeLedger(row({ decision_reasons: "[5]" }), context);
  assert.equal(baseline.status, "PASS");
  assert.equal(baseline.mappedUnique, 2);
  assert.equal(baselineWarning.status, "mapped");

  const originalIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  let observed: ReturnType<typeof reconcileDecisionHistoryRowsToRuntimeLedger> | undefined;
  let invalidSource: ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger> | undefined;
  let invalidRunKind: ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger> | undefined;
  let lateProgram: ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger> | undefined;
  let warning: ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger> | undefined;
  let valid: ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger> | undefined;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true, writable: true, value: function* () {},
    });
    observed = reconcileDecisionHistoryRowsToRuntimeLedger(sourceRows, context);
    invalidSource = mapDecisionHistoryRowToRuntimeLedger(row({ source: "" }), context);
    invalidRunKind = mapDecisionHistoryRowToRuntimeLedger(row({ run_kind: "" }), context);
    lateProgram = mapDecisionHistoryRowToRuntimeLedger(
      row({ program_imported_at: "2026-08-05 05:30:00" }), context,
    );
    warning = mapDecisionHistoryRowToRuntimeLedger(row({ decision_reasons: "[5]" }), context);
    valid = mapDecisionHistoryRowToRuntimeLedger(row(), context);
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, originalIterator);
  }

  assert.equal(observed?.status, "PASS");
  assert.equal(observed?.sourceRows, 2);
  assert.equal(observed?.mappedUnique, 2);
  assert.equal(observed?.recordsDigest, baseline.recordsDigest);
  assert.deepEqual(observed?.records.map((record) => record.recordId), baseline.records.map((record) => record.recordId));
  assert.equal(invalidSource?.status, "rejected");
  if (invalidSource?.status === "rejected") assert.ok(invalidSource.reasons.includes("source must be non-empty"));
  assert.equal(invalidRunKind?.status, "rejected");
  if (invalidRunKind?.status === "rejected") assert.ok(invalidRunKind.reasons.includes("run_kind must be non-empty"));
  assert.equal(lateProgram?.status, "unresolved");
  if (lateProgram?.status === "unresolved") {
    assert.ok(lateProgram.reasons.includes("close_time_not_proven_visible_at_decision"));
  }
  assert.equal(warning?.status, "mapped");
  if (warning?.status === "mapped" && baselineWarning.status === "mapped") {
    assert.deepEqual(warning.record.warnings, baselineWarning.record.warnings);
    assert.equal(warning.ledgerDigest, baselineWarning.ledgerDigest);
  }
  assert.equal(valid?.status, "mapped");
});

test("shadow reconciliation fails closed on sparse or accessor source rows", () => {
  const rows: DecisionHistoryShadowRow[] = [row({ id: 1001 }), row({ id: 1002 })];
  Object.defineProperty(rows, "1", {
    configurable: true, enumerable: true,
    get() { throw new Error("untrusted row accessor must not execute"); },
  });
  const result = reconcileDecisionHistoryRowsToRuntimeLedger(rows, context);
  assert.equal(result.status, "CONDITIONAL");
  assert.equal(result.sourceRows, 2);
  assert.equal(result.mappedUnique, 1);
  assert.equal(result.rejectedCount, 1);
  assert.deepEqual(result.rejected[0]?.reasons, ["source_row_not_own_data_object"]);

  const sparse: DecisionHistoryShadowRow[] = [row()];
  sparse.length = 2;
  const sparseResult = reconcileDecisionHistoryRowsToRuntimeLedger(sparse, context);
  assert.equal(sparseResult.status, "CONDITIONAL");
  assert.equal(sparseResult.rejectedCount, 1);
});

test("shadow reconciliation preserves membership, exact duplicates and conflicts under ambient Map hooks", () => {
  // Synthetic-only: Map.prototype hooks must not erase accepted shadow rows or
  // turn a changed same-identity source row into an apparent PASS.
  const sourceRows = [
    row({ id: 1002 }),
    row({ id: 1001 }),
    row({ id: 1001 }),
    row({ id: 1001, current_odds: 7.1 }),
  ];
  const baseline = reconcileDecisionHistoryRowsToRuntimeLedger(sourceRows, context);
  assert.equal(baseline.status, "FAILED");
  assert.equal(baseline.sourceRows, 4);
  assert.equal(baseline.mappedUnique, 2);
  assert.equal(baseline.exactDuplicates, 1);
  assert.equal(baseline.conflictCount, 1);

  const originalGet = Object.getOwnPropertyDescriptor(Map.prototype, "get")!;
  const originalSet = Object.getOwnPropertyDescriptor(Map.prototype, "set")!;
  const originalValues = Object.getOwnPropertyDescriptor(Map.prototype, "values")!;
  let observed: ReturnType<typeof reconcileDecisionHistoryRowsToRuntimeLedger> | undefined;
  try {
    Object.defineProperty(Map.prototype, "get", {
      configurable: true, writable: true, value() { return undefined; },
    });
    Object.defineProperty(Map.prototype, "set", {
      configurable: true, writable: true, value() { return this; },
    });
    Object.defineProperty(Map.prototype, "values", {
      configurable: true, writable: true, value: function* () {},
    });
    observed = reconcileDecisionHistoryRowsToRuntimeLedger(sourceRows, context);
  } finally {
    Object.defineProperty(Map.prototype, "values", originalValues);
    Object.defineProperty(Map.prototype, "set", originalSet);
    Object.defineProperty(Map.prototype, "get", originalGet);
  }

  assert.equal(observed?.status, baseline.status);
  assert.equal(observed?.sourceRows, baseline.sourceRows);
  assert.equal(observed?.mappedUnique, baseline.mappedUnique);
  assert.equal(observed?.exactDuplicates, baseline.exactDuplicates);
  assert.equal(observed?.conflictCount, baseline.conflictCount);
  assert.equal(observed?.recordsDigest, baseline.recordsDigest);
  assert.deepEqual(observed?.records.map((record) => record.recordId),
    baseline.records.map((record) => record.recordId));
});

test("shadow mapper retains warning evidence and digest under ambient Set hooks", () => {
  const source = row({
    decision_reasons: "[5]",
    feature_adjustment: null,
    feature_adjustment_breakdown: "invalid-json",
  });
  const baseline = mapDecisionHistoryRowToRuntimeLedger(source, context);
  assert.equal(baseline.status, "mapped");
  if (baseline.status !== "mapped") return;
  assert.deepEqual(baseline.record.warnings, [
    "decision_reasons_not_string_array",
    "feature_adjustment_unavailable",
    "feature_adjustment_breakdown_invalid_json",
  ]);

  const originalHas = Object.getOwnPropertyDescriptor(Set.prototype, "has")!;
  const originalAdd = Object.getOwnPropertyDescriptor(Set.prototype, "add")!;
  let observed: ReturnType<typeof mapDecisionHistoryRowToRuntimeLedger> | undefined;
  try {
    Object.defineProperty(Set.prototype, "has", {
      configurable: true, writable: true, value() { return true; },
    });
    Object.defineProperty(Set.prototype, "add", {
      configurable: true, writable: true, value() { return this; },
    });
    observed = mapDecisionHistoryRowToRuntimeLedger(source, context);
  } finally {
    Object.defineProperty(Set.prototype, "add", originalAdd);
    Object.defineProperty(Set.prototype, "has", originalHas);
  }

  assert.equal(observed?.status, "mapped");
  if (observed?.status !== "mapped") return;
  assert.deepEqual(observed.record.warnings, baseline.record.warnings);
  assert.equal(observed.ledgerDigest, baseline.ledgerDigest);
});

test("shadow mapper pins source-row descriptors before validation, audit digest and ledger mapping", () => {
  const baseline = mapDecisionHistoryRowToRuntimeLedger(row(), context);
  assert.equal(baseline.status, "mapped");
  if (baseline.status !== "mapped") return;

  // An accessor could return one value to validation and another to the
  // audit/record. Reject it without invoking any caller-controlled getter.
  const accessorRow = row();
  let getterReads = 0;
  Object.defineProperty(accessorRow, "current_odds", {
    configurable: true, enumerable: true,
    get() { getterReads++; return getterReads === 1 ? 6.4 : 7.1; },
  });
  const invalid = mapDecisionHistoryRowToRuntimeLedger(accessorRow, context);
  assert.equal(invalid.status, "rejected");
  assert.equal(getterReads, 0);
  if (invalid.status === "rejected") {
    assert.deepEqual(invalid.reasons, ["source_row_fields_not_own_data"]);
  }
  const reconciled = reconcileDecisionHistoryRowsToRuntimeLedger([row(), accessorRow], context);
  assert.equal(reconciled.status, "CONDITIONAL");
  assert.equal(reconciled.mappedUnique, 1);
  assert.equal(reconciled.rejectedCount, 1);
  assert.equal(getterReads, 0);

  // The same descriptor-backed row must not be reread through a mutable
  // Proxy get trap after validation; the mapped evidence stays identical.
  let directReads = 0;
  const proxyRow = new Proxy(row(), {
    get(target, property, receiver) {
      directReads++;
      if (property === "current_odds") return 7.1;
      return Reflect.get(target, property, receiver);
    },
  });
  const pinned = mapDecisionHistoryRowToRuntimeLedger(proxyRow, context);
  assert.equal(pinned.status, "mapped");
  assert.equal(directReads, 0);
  if (pinned.status === "mapped") {
    assert.equal(pinned.record.currentOdds, baseline.record.currentOdds);
    assert.equal(pinned.record.sourceRowDigest, baseline.record.sourceRowDigest);
    assert.equal(pinned.ledgerDigest, baseline.ledgerDigest);
  }
});

test("shadow mapper pins mapping context identity across row and reconciliation digests", () => {
  const baseline = mapDecisionHistoryRowToRuntimeLedger(row(), context);
  assert.equal(baseline.status, "mapped");
  if (baseline.status !== "mapped") return;

  let getterReads = 0;
  const accessorContext = { ...context };
  Object.defineProperty(accessorContext, "decisionSystem", {
    configurable: true, enumerable: true,
    get() { getterReads++; return getterReads === 1 ? "shadow-A" : "shadow-B"; },
  });
  const invalid = mapDecisionHistoryRowToRuntimeLedger(row(), accessorContext);
  assert.equal(invalid.status, "rejected");
  if (invalid.status === "rejected") {
    assert.deepEqual(invalid.reasons, ["mapping_context_fields_not_own_data"]);
  }
  const denied = reconcileDecisionHistoryRowsToRuntimeLedger([row(), row({ id: 1002 })], accessorContext);
  assert.equal(denied.status, "CONDITIONAL");
  assert.equal(denied.mappedUnique, 0);
  assert.equal(denied.rejectedCount, 1);
  assert.equal(getterReads, 0);

  const optionalAccessor = { ...context };
  Object.defineProperty(optionalAccessor, "lineNotificationEligible", {
    configurable: true, enumerable: true,
    get() { throw new Error("notification accessor must not execute"); },
  });
  assert.equal(mapDecisionHistoryRowToRuntimeLedger(row(), optionalAccessor).status, "rejected");

  let directReads = 0;
  const proxyContext = new Proxy({ ...context }, {
    get(target, property, receiver) {
      directReads++;
      if (property === "decisionSystem") return "shadow-tampered";
      return Reflect.get(target, property, receiver);
    },
  });
  const pinned = mapDecisionHistoryRowToRuntimeLedger(row(), proxyContext);
  assert.equal(pinned.status, "mapped");
  assert.equal(directReads, 0);
  if (pinned.status === "mapped") {
    assert.equal(pinned.record.recordId, baseline.record.recordId);
    assert.equal(pinned.record.decisionSystem, baseline.record.decisionSystem);
    assert.equal(pinned.ledgerDigest, baseline.ledgerDigest);
  }
  const sourceRows = [row({ id: 1001 }), row({ id: 1002 })];
  const expected = reconcileDecisionHistoryRowsToRuntimeLedger(sourceRows, context);
  const observed = reconcileDecisionHistoryRowsToRuntimeLedger(sourceRows, proxyContext);
  assert.equal(observed.status, "PASS");
  assert.equal(observed.mappedUnique, 2);
  assert.equal(observed.recordsDigest, expected.recordsDigest);
  assert.equal(directReads, 0);
});

test("shadow reconciliation rejects Proxy source-row containers before length or descriptor traps", () => {
  const ordinary = [row({ id: 1001 }), row({ id: 1002 })];
  const baseline = reconcileDecisionHistoryRowsToRuntimeLedger(ordinary, context);
  assert.equal(baseline.status, "PASS");
  assert.equal(baseline.sourceRows, 2);
  assert.equal(baseline.mappedUnique, 2);

  let lengthReads = 0;
  let descriptorReads = 0;
  const spoofed = new Proxy(ordinary, {
    get(target, property, receiver) {
      if (property === "length") {
        lengthReads++;
        return 0; // Previously produced PASS with zero visited rows.
      }
      return Reflect.get(target, property, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      descriptorReads++;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  const denied = reconcileDecisionHistoryRowsToRuntimeLedger(spoofed, context);
  assert.equal(denied.status, "CONDITIONAL");
  assert.equal(denied.sourceRows, 0); // Untrusted count, not an asserted empty cohort.
  assert.equal(denied.mappedUnique, 0);
  assert.equal(denied.rejectedCount, 1);
  assert.deepEqual(denied.rejected[0]?.reasons, ["source_rows_proxy_not_admitted"]);
  assert.equal(lengthReads, 0);
  assert.equal(descriptorReads, 0);

  // Node's isProxy guard must also reject revoked arrays without executing traps.
  const revoked = Proxy.revocable([row()], {});
  revoked.revoke();
  const revokedResult = reconcileDecisionHistoryRowsToRuntimeLedger(revoked.proxy, context);
  assert.equal(revokedResult.status, "CONDITIONAL");
  assert.deepEqual(revokedResult.rejected[0]?.reasons, ["source_rows_proxy_not_admitted"]);
});

test("shadow mapper denies nested source-row and mapping-context Proxies before descriptor hooks", () => {
  const baseline = mapDecisionHistoryRowToRuntimeLedger(row(), context);
  assert.equal(baseline.status, "mapped");
  if (baseline.status !== "mapped") return;

  let descriptorReads = 0;
  let getterReads = 0;
  const traps = {
    getOwnPropertyDescriptor(target: object, key: string | symbol) {
      descriptorReads += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target: object, key: string | symbol, receiver: unknown) {
      getterReads += 1;
      return Reflect.get(target, key, receiver);
    },
  };
  const proxyRow = new Proxy(row(), traps);
  const proxyContext = new Proxy({ ...context }, traps);
  const rejectedRow = mapDecisionHistoryRowToRuntimeLedger(proxyRow, context);
  assert.equal(rejectedRow.status, "rejected");
  if (rejectedRow.status === "rejected") {
    assert.deepEqual(rejectedRow.reasons, ["source_row_fields_not_own_data"]);
  }
  const rejectedContext = mapDecisionHistoryRowToRuntimeLedger(row(), proxyContext);
  assert.equal(rejectedContext.status, "rejected");
  if (rejectedContext.status === "rejected") {
    assert.deepEqual(rejectedContext.reasons, ["mapping_context_fields_not_own_data"]);
  }

  const reconciledRow = reconcileDecisionHistoryRowsToRuntimeLedger([proxyRow], context);
  assert.equal(reconciledRow.status, "CONDITIONAL");
  assert.equal(reconciledRow.sourceRows, 1);
  assert.equal(reconciledRow.mappedUnique, 0);
  assert.equal(reconciledRow.rejectedCount, 1);
  const reconciledContext = reconcileDecisionHistoryRowsToRuntimeLedger([row()], proxyContext);
  assert.equal(reconciledContext.status, "CONDITIONAL");
  assert.equal(reconciledContext.mappedUnique, 0);
  assert.equal(reconciledContext.rejectedCount, 1);
  assert.equal(descriptorReads, 0, "untrusted descriptor traps must never execute");
  assert.equal(getterReads, 0, "untrusted getter traps must never execute");

  const revokedRow = Proxy.revocable(row(), {});
  revokedRow.revoke();
  const revokedContext = Proxy.revocable({ ...context }, {});
  revokedContext.revoke();
  assert.equal(mapDecisionHistoryRowToRuntimeLedger(revokedRow.proxy, context).status, "rejected");
  assert.equal(mapDecisionHistoryRowToRuntimeLedger(row(), revokedContext.proxy).status, "rejected");
  assert.equal(reconcileDecisionHistoryRowsToRuntimeLedger([revokedRow.proxy], context).status, "CONDITIONAL");
  assert.equal(reconcileDecisionHistoryRowsToRuntimeLedger([row()], revokedContext.proxy).status, "CONDITIONAL");

  const after = mapDecisionHistoryRowToRuntimeLedger(row(), context);
  assert.equal(after.status, "mapped");
  if (after.status === "mapped") assert.equal(after.ledgerDigest, baseline.ledgerDigest);
});
