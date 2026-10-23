import assert from "node:assert/strict";
import test from "node:test";
import {
  assessForwardV02Candidate,
  FORWARD_V02_CANDIDATE_VERSION,
} from "./forwardEvaluationProtocolV02Candidate";

function candidate() {
  return {
    schemaVersion: FORWARD_V02_CANDIDATE_VERSION,
    kind: "EVALUATION_PROTOCOL",
    protocolId: "synthetic-v02-unapproved",
    protocolVersion: "0.2-candidate",
    status: "UNAPPROVED",
    evidenceStage: "SHADOW_FORWARD",
    createdAt: "2026-10-24T00:00:00Z",
    comparisonMode: "COMMON_COHORT",
    oddsBasis: "BUY_TIME",
    metricFormulaId: "NET_ROI_ON_STAKE_V1",
    metricFormulaDigest: "a".repeat(64),
    moneyPolicy: {
      currency: "JPY", unit: "INTEGER_YEN",
      netRoiFormula: "(SUM_PAYOUT_MINUS_SUM_STAKE)/SUM_STAKE",
      refund: "EXCLUDE_AND_COUNT", void: "EXCLUDE_AND_COUNT",
      cancelled: "EXCLUDE_AND_COUNT", unresolved: "EXCLUDE_AND_COUNT",
      zeroDenominator: "UNSCORABLE_AND_REPORT",
    },
    maxHitPolicy: {
      eventUnit: "CANONICAL_RACE", exclusionAlignment: "SHARED_PREDECLARED_RACE",
      tieBreak: "LEXICOGRAPHIC_EVENT_ID_ASC", noPositiveEvent: "REMOVE_NONE",
      stakeAndPayoutRemoval: "REMOVE_BOTH",
    },
    samplePolicy: {
      minDecisions: 1, minRaces: 1, grouping: "PER_STAGE_PER_DECISION_SYSTEM",
    },
    exclusionReasons: [
      "REFUNDED", "VOID", "CANCELLED", "UNRESOLVED", "NONFINAL",
      "NOT_EVALUABLE", "IDENTITY_MISMATCH", "NOT_ENROLLED",
    ],
    benchmarkDecisionSystems: ["synthetic-shadow", "synthetic-benchmark"],
    evidenceRequirements: {
      outcome: "INDEPENDENT_EXACT_FINAL_EVALUABLE_SETTLED",
      sourceManifest: "INDEPENDENT_DIGEST_RECONCILIATION",
      enrollment: "PROSPECTIVE_FROZEN_BEFORE_DECISION",
      stagePooling: "PROHIBITED",
    },
    productionConnection: false,
    scoringAuthorized: false,
  };
}

const blockers = (input: unknown) => assessForwardV02Candidate(input).blockers;

test("complete synthetic candidate remains unauthorized without independent evidence", () => {
  assert.deepEqual(assessForwardV02Candidate(candidate()), {
    candidateComplete: true,
    scoringAuthorized: false,
    blockers: ["UNAPPROVED_PROTOCOL", "INDEPENDENT_EVIDENCE_NOT_VERIFIED"],
  });
});

test("no implicit migration from v0.1 or scoring authorization by assertion", () => {
  assert.deepEqual(blockers({ ...candidate(), schemaVersion: "forward-evaluation-vault.0.1" }), ["INVALID_CANDIDATE_HEADER"]);
  assert.deepEqual(blockers({ ...candidate(), scoringAuthorized: true }), ["INVALID_CANDIDATE_HEADER"]);
  assert.deepEqual(blockers({ ...candidate(), productionConnection: true }), ["INVALID_CANDIDATE_HEADER"]);
  assert.deepEqual(blockers({ ...candidate(), status: "APPROVED" }), ["INVALID_CANDIDATE_HEADER"]);
});

test("formula identity and digest cannot be omitted or silently replaced", () => {
  assert.deepEqual(blockers({ ...candidate(), metricFormulaId: "NET_ROI_V2" }), ["INVALID_CANDIDATE_HEADER"]);
  assert.deepEqual(blockers({ ...candidate(), metricFormulaDigest: "invalid" }), ["INVALID_CANDIDATE_HEADER"]);
  const x = candidate();
  delete (x as Partial<typeof x>).metricFormulaDigest;
  assert.deepEqual(blockers(x), ["INVALID_CANDIDATE_SHAPE"]);
});

test("refund, void, cancellation and unresolved semantics are explicit", () => {
  for (const key of ["refund", "void", "cancelled", "unresolved"] as const) {
    const x = candidate();
    x.moneyPolicy[key] = "TREAT_AS_LOSS";
    assert.deepEqual(blockers(x), ["UNFROZEN_MONEY_OR_OUTCOME_POLICY"]);
  }
  assert.deepEqual(blockers({ ...candidate(), moneyPolicy: { ...candidate().moneyPolicy, zeroDenominator: "ZERO" } }),
    ["UNFROZEN_MONEY_OR_OUTCOME_POLICY"]);
});

test("max-hit event identity, tie-break, stake and payout removal are fixed", () => {
  for (const [field, value] of [
    ["eventUnit", "UNSPECIFIED"], ["tieBreak", "HIGHEST_PAYOUT_FIRST"],
    ["noPositiveEvent", "REMOVE_FIRST"], ["stakeAndPayoutRemoval", "REMOVE_PAYOUT_ONLY"],
  ] as const) {
    const x = candidate();
    x.maxHitPolicy[field] = value;
    assert.deepEqual(blockers(x), ["UNFROZEN_MAX_HIT_POLICY"]);
  }
});

test("common-cohort comparisons reject system-specific exclusions", () => {
  const x = candidate();
  x.maxHitPolicy.exclusionAlignment = "SYSTEM_SPECIFIC_SENSITIVITY_ONLY";
  assert.deepEqual(blockers(x), ["COMMON_COHORT_EXCLUSION_MISALIGNMENT"]);
  x.comparisonMode = "SELECTED_RACE";
  assert.equal(assessForwardV02Candidate(x).candidateComplete, true);
  assert.equal(assessForwardV02Candidate(x).scoringAuthorized, false);
});

test("shared predeclared race exclusion requires race-level event identity", () => {
  const x = candidate();
  x.maxHitPolicy.eventUnit = "DECISION_RECORD";
  assert.deepEqual(blockers(x), ["INCONSISTENT_EXCLUSION_UNIT"]);
});

test("minimum samples are policy fields, not invented readiness counts", () => {
  for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    const x = candidate();
    x.samplePolicy.minDecisions = invalid;
    assert.deepEqual(blockers(x), ["UNFROZEN_SAMPLE_POLICY"]);
  }
  const x = candidate();
  x.samplePolicy.minRaces = 0;
  assert.deepEqual(blockers(x), ["UNFROZEN_SAMPLE_POLICY"]);
});

test("all exclusion reasons must be present exactly once", () => {
  const x = candidate();
  x.exclusionReasons.pop();
  assert.deepEqual(blockers(x), ["INCOMPLETE_EXCLUSION_TAXONOMY"]);
  x.exclusionReasons.push("REFUNDED");
  assert.deepEqual(blockers(x), ["INVALID_CANDIDATE_SHAPE"].includes("unused")
    ? ["INVALID_CANDIDATE_SHAPE"] : ["INCOMPLETE_EXCLUSION_TAXONOMY"]);
  const y = candidate();
  y.exclusionReasons[0] = "SILENT_DROP";
  assert.deepEqual(blockers(y), ["INCOMPLETE_EXCLUSION_TAXONOMY"]);
});

test("caller declarations cannot replace independent source and enrollment proof", () => {
  const x = candidate();
  x.evidenceRequirements.sourceManifest = "CALLER_ASSERTED_EXACT";
  assert.deepEqual(blockers(x), ["MISSING_INDEPENDENT_EVIDENCE_REQUIREMENTS"]);
  const y = candidate();
  y.evidenceRequirements.enrollment = "POST_HOC";
  assert.deepEqual(blockers(y), ["MISSING_INDEPENDENT_EVIDENCE_REQUIREMENTS"]);
});

test("unknown, accessor, symbol, sparse and inherited-toJSON shapes fail closed", () => {
  assert.deepEqual(blockers({ ...candidate(), arbitraryMetric: 999 }), ["INVALID_CANDIDATE_SHAPE"]);
  const accessor = Object.defineProperty({ ...candidate() }, "status", {
    enumerable: true, get() { throw new Error("synthetic getter"); },
  });
  assert.deepEqual(blockers(accessor), ["INVALID_CANDIDATE_SHAPE"]);
  const symbol = candidate() as Record<string | symbol, unknown>;
  symbol[Symbol("synthetic")] = true;
  assert.deepEqual(blockers(symbol), ["INVALID_CANDIDATE_SHAPE"]);
  const sparse = candidate();
  sparse.benchmarkDecisionSystems = new Array(2) as string[];
  sparse.benchmarkDecisionSystems[1] = "synthetic";
  assert.deepEqual(blockers(sparse), ["INVALID_BENCHMARK_SET"]);
  const hooked = candidate();
  Object.defineProperty(hooked.exclusionReasons, "toJSON", { value: () => [] });
  assert.deepEqual(blockers(hooked), ["INCOMPLETE_EXCLUSION_TAXONOMY"]);
});

test("calendar, stage, and source-manifest requirements cannot be inferred", () => {
  assert.deepEqual(blockers({ ...candidate(), createdAt: "2026-02-30T00:00:00Z" }), ["INVALID_CANDIDATE_HEADER"]);
  assert.deepEqual(blockers({ ...candidate(), createdAt: "2026-10-24T24:00:00Z" }), ["INVALID_CANDIDATE_HEADER"]);
  assert.deepEqual(blockers({ ...candidate(), evidenceStage: "MIXED" }), ["INVALID_CANDIDATE_HEADER"]);
  const x = candidate();
  x.evidenceRequirements.stagePooling = "ALLOWED";
  assert.deepEqual(blockers(x), ["MISSING_INDEPENDENT_EVIDENCE_REQUIREMENTS"]);
});
