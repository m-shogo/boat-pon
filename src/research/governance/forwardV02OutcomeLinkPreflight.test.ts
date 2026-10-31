import assert from "node:assert/strict";
import test from "node:test";
import {
  runtimeDecisionLedgerDigest, type RuntimeDecisionLedgerRecord,
} from "./runtimeDecisionLedger";
import {
  outcomeLearningLedgerDigest, type OutcomeLearningLedgerRecord,
} from "./outcomeLearningLedger";
import { FORWARD_V02_CANDIDATE_VERSION } from "./forwardEvaluationProtocolV02Candidate";
import {
  forwardV02FormulaReferenceDigest, forwardV02SourceManifestReferenceDigest,
} from "./forwardV02ReferenceReconciliation";
import { assessForwardV02OutcomeLinkPreflight } from "./forwardV02OutcomeLinkPreflight";

const h = (c: string) => c.repeat(64);
function decision(): RuntimeDecisionLedgerRecord {
  return {
    schemaVersion: "runtime-decision-ledger.0.1",
    recordId: "synthetic-decision-record", decisionId: "synthetic-decision",
    canonicalRaceId: "synthetic-race", sourceDecisionHistoryId: null,
    decisionSystem: "synthetic-a", strategyVersion: "synthetic-v1",
    modelVersion: "synthetic-v1", featureVersion: "synthetic-v1",
    manifestId: "synthetic-enrollment", cohortId: "synthetic-cohort",
    evaluationMode: "shadow_forward", ticketType: "trifecta", selection: "1-2-3",
    decision: "BUY", decisionAt: "2026-10-24T00:00:00.0002Z",
    oddsObservedAt: "2026-10-23T23:59:59Z",
    scheduledCloseAtSeen: "2026-10-24T00:00:02Z",
    currentOdds: 2, requiredOdds: 1.5, estimatedHitRate: 0.5,
    rawEstimatedHitRate: 0.5, expectedValue: 0.1,
    recommendedStakeYen: 100, sampleSize: 10,
    reasons: ["synthetic"], warnings: [], dataCompleteness: "complete",
    notificationEligible: false, notificationDedupeKey: null,
    sourceRowDigest: h("e"),
  };
}
function outcome(): OutcomeLearningLedgerRecord {
  return {
    schemaVersion: "outcome-learning-ledger.0.1",
    outcomeRecordId: "synthetic-outcome-record",
    decisionRecordId: "synthetic-decision-record", decisionId: "synthetic-decision",
    canonicalRaceId: "synthetic-race", ticketType: "trifecta", selection: "1-2-3",
    settlementId: "synthetic-settlement", settledAt: "2026-10-24T00:00:00.0003Z",
    finality: "FINAL", disposition: "SETTLED", evaluable: true,
    stakeYen: 100, payoutYen: 200, refundYen: 0, refundReason: null,
    popularity: null, sourceEvidenceDigests: [h("a")],
    provenanceVersion: "synthetic-v1",
  };
}
function formula() {
  return {
    formulaId: "NET_ROI_ON_STAKE_V1",
    expression: "(SUM_PAYOUT_MINUS_SUM_STAKE)/SUM_STAKE",
    currency: "JPY", unit: "INTEGER_YEN", denominator: "SUM_STAKE",
  };
}
function candidate() {
  return {
    schemaVersion: FORWARD_V02_CANDIDATE_VERSION, kind: "EVALUATION_PROTOCOL",
    protocolId: "synthetic-v02", protocolVersion: "0.2-candidate",
    status: "UNAPPROVED", evidenceStage: "SHADOW_FORWARD",
    createdAt: "2026-10-23T00:00:00Z",
    comparisonMode: "COMMON_COHORT", oddsBasis: "BUY_TIME",
    metricFormulaId: "NET_ROI_ON_STAKE_V1",
    metricFormulaDigest: forwardV02FormulaReferenceDigest(formula())!,
    moneyPolicy: {
      currency: "JPY", unit: "INTEGER_YEN",
      netRoiFormula: "(SUM_PAYOUT_MINUS_SUM_STAKE)/SUM_STAKE",
      stakePopulation: "EVALUABLE_SETTLED_STAKE_ONLY",
      returnPopulation: "EVALUABLE_SETTLED_PAYOUT_ONLY",
      specialPayout: "EXCLUDE_AND_COUNT",
      refund: "EXCLUDE_AND_COUNT", void: "EXCLUDE_AND_COUNT",
      cancelled: "EXCLUDE_AND_COUNT", unresolved: "EXCLUDE_AND_COUNT",
      zeroDenominator: "UNSCORABLE_AND_REPORT",
    },
    maxHitPolicy: {
      eventUnit: "CANONICAL_RACE", exclusionAlignment: "SHARED_PREDECLARED_RACE",
      tieBreak: "LEXICOGRAPHIC_EVENT_ID_ASC", noPositiveEvent: "REMOVE_NONE",
      stakeAndPayoutRemoval: "REMOVE_BOTH",
    },
    samplePolicy: { minDecisions: 1, minRaces: 1, grouping: "PER_STAGE_PER_DECISION_SYSTEM" },
    exclusionReasons: [
      "REFUNDED", "VOID", "CANCELLED", "UNRESOLVED", "NONFINAL",
      "NOT_EVALUABLE", "IDENTITY_MISMATCH", "NOT_ENROLLED", "SPECIAL_PAYOUT",
    ],
    benchmarkDecisionSystems: ["synthetic-a", "synthetic-b"],
    evidenceRequirements: {
      outcome: "INDEPENDENT_EXACT_FINAL_EVALUABLE_SETTLED",
      sourceManifest: "INDEPENDENT_DIGEST_RECONCILIATION",
      enrollment: "PROSPECTIVE_FROZEN_BEFORE_DECISION", stagePooling: "PROHIBITED",
    },
    productionConnection: false, scoringAuthorized: false,
  };
}
function bundle(
  d: RuntimeDecisionLedgerRecord[] = [decision()],
  o: OutcomeLearningLedgerRecord[] = [outcome()],
) {
  const c = candidate();
  const m = {
    schemaVersion: "forward-source-manifest.0.2-candidate",
    manifestId: "synthetic-source-manifest", evidenceStage: c.evidenceStage,
    analysisSnapshotDigest: h("b"),
    decisionDigests: d.map(runtimeDecisionLedgerDigest),
    outcomeDigests: o.map(outcomeLearningLedgerDigest),
    createdAt: "2026-10-24T00:00:03Z", productionConnection: false,
  };
  const digest = forwardV02SourceManifestReferenceDigest(m)!;
  const r = {
    formula: formula(), formulaDigest: forwardV02FormulaReferenceDigest(formula())!,
    sourceManifest: m, expectedSourceManifestDigest: digest,
    resultSourceManifestDigest: digest, expectedAnalysisSnapshotDigest: h("b"),
  };
  return { c, r, d, o };
}
function check(b: ReturnType<typeof bundle>) {
  return assessForwardV02OutcomeLinkPreflight(b.c, b.r, b.d, b.o);
}
const blocked = (b: ReturnType<typeof bundle>) => check(b).blockers;

test("matching synthetic ledger digests and ticket identity never authorize scoring", () => {
  assert.deepEqual(check(bundle()), {
    outcomeReferencesLinked: true, excludedOutcomePresent: false,
    scoringAuthorized: false,
    blockers: ["UNAPPROVED_PROTOCOL", "INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED",
      "PROSPECTIVE_ENROLLMENT_NOT_ATTESTED"],
  });
});
test("outcome payout mutation after manifest freeze is rejected", () => {
  const b = bundle(); b.o[0]!.payoutYen++;
  assert.deepEqual(blocked(b), ["OUTCOME_DIGEST_MISMATCH"]);
});
test("decision mutation after manifest freeze is rejected", () => {
  const b = bundle(); b.d[0]!.sourceRowDigest = h("f");
  assert.deepEqual(blocked(b), ["DECISION_DIGEST_MISMATCH"]);
});
test("arbitrary or inconsistent source manifest digest is not accepted", () => {
  const b = bundle(); b.r.resultSourceManifestDigest = h("f");
  assert.deepEqual(blocked(b), ["REFERENCE_CONTEXT_NOT_RECONCILED"]);
});
test("rehashed wrong ticket, race, and decision identity cannot link", () => {
  for (const change of [
    { selection: "1-2-4" }, { canonicalRaceId: "other-race" },
    { decisionId: "other-decision" }, { decisionRecordId: "other-record" },
  ]) {
    assert.deepEqual(blocked(bundle([decision()], [{ ...outcome(), ...change }])),
      ["OUTCOME_DECISION_LINK_MISMATCH"]);
  }
});
test("a valid refunded or void outcome is retained but never silently scored", () => {
  const refunded: OutcomeLearningLedgerRecord = {
    ...outcome(), disposition: "REFUNDED", evaluable: false,
    payoutYen: 0, refundYen: 100, refundReason: "synthetic-refund",
  };
  const voided: OutcomeLearningLedgerRecord = {
    ...outcome(), disposition: "VOID", finality: "VOID",
    evaluable: false, payoutYen: 0, refundReason: "synthetic-void",
  };
  for (const o of [refunded, voided]) {
    const result = check(bundle([decision()], [o]));
    assert.equal(result.outcomeReferencesLinked, true);
    assert.equal(result.excludedOutcomePresent, true);
    assert.equal(result.scoringAuthorized, false);
  }
});
test("an evaluable refund is invalid before digest admission", () => {
  const b = bundle(); b.o[0]!.disposition = "REFUNDED";
  b.o[0]!.refundYen = 100; b.o[0]!.refundReason = "synthetic-refund";
  assert.deepEqual(blocked(b), ["INVALID_OUTCOME_RECORD"]);
});
test("submillisecond settlement preceding decision is rejected", () => {
  const o = { ...outcome(), settledAt: "2026-10-24T00:00:00.0001Z" };
  assert.deepEqual(blocked(bundle([decision()], [o])), ["OUTCOME_PRECEDES_DECISION"]);
});
test("decision evaluation stage cannot be relabeled by the manifest", () => {
  const d = { ...decision(), evaluationMode: "historical" as const };
  assert.deepEqual(blocked(bundle([d], [outcome()])), ["DECISION_STAGE_MISMATCH"]);
});
test("untouched holdout cannot be mapped to a nonexistent Runtime Ledger 0.1 mode", () => {
  const b = bundle();
  b.c.evidenceStage = "UNTOUCHED_HOLDOUT";
  b.r.sourceManifest.evidenceStage = "UNTOUCHED_HOLDOUT";
  const digest = forwardV02SourceManifestReferenceDigest(b.r.sourceManifest)!;
  b.r.expectedSourceManifestDigest = digest; b.r.resultSourceManifestDigest = digest;
  assert.deepEqual(blocked(b), ["UNSUPPORTED_STAGE_MAPPING"]);
});
test("duplicate decision identity with different canonical payload is rejected", () => {
  const d = decision();
  const other = { ...decision(), sourceRowDigest: h("f") };
  assert.deepEqual(blocked(bundle([d, other], [outcome()])), ["DUPLICATE_DECISION_RECORD_ID"]);
});
test("duplicate outcome identity with different canonical payload is rejected", () => {
  const other = { ...outcome(), settlementId: "synthetic-settlement-2", payoutYen: 300 };
  assert.deepEqual(blocked(bundle([decision()], [outcome(), other])), ["DUPLICATE_OUTCOME_RECORD_ID"]);
});
test("multiple settlement revisions for one decision require independent resolution", () => {
  const other = {
    ...outcome(), outcomeRecordId: "synthetic-outcome-2",
    settlementId: "synthetic-settlement-2", payoutYen: 300,
  };
  assert.deepEqual(blocked(bundle([decision()], [outcome(), other])),
    ["MULTIPLE_SETTLEMENTS_FOR_DECISION"]);
});
test("WATCH/SKIP decisions cannot acquire an evaluable ticket outcome", () => {
  const d: RuntimeDecisionLedgerRecord = {
    ...decision(), decision: "WATCH", recommendedStakeYen: 0,
    currentOdds: null, requiredOdds: null, estimatedHitRate: null,
    rawEstimatedHitRate: null, expectedValue: null, oddsObservedAt: null,
  };
  assert.deepEqual(blocked(bundle([d], [outcome()])), ["NON_BUY_OUTCOME_LINK"]);
});
test("extra, sparse, or accessor ledger collections fail closed", () => {
  const extra = bundle();
  Object.defineProperty(extra.o, "untracked", { value: 1 });
  assert.deepEqual(blocked(extra), ["INVALID_LEDGER_COLLECTION"]);
  const sparse = bundle();
  sparse.o = new Array<OutcomeLearningLedgerRecord>(1);
  assert.deepEqual(blocked(sparse), ["INVALID_LEDGER_COLLECTION"]);
  const accessor = bundle();
  Object.defineProperty(accessor.o, "0", { get() { throw new Error("unsafe"); } });
  assert.deepEqual(blocked(accessor), ["INVALID_LEDGER_COLLECTION"]);
});
test("manifest/ledger count disagreement fails before linkage", () => {
  const b = bundle();
  b.o = [outcome(), { ...outcome(), outcomeRecordId: "extra" }];
  assert.deepEqual(blocked(b), ["MANIFEST_LEDGER_CARDINALITY_MISMATCH"]);
});
test("a candidate that asserts production scoring is rejected", () => {
  const b = bundle(); b.c.scoringAuthorized = true;
  assert.deepEqual(blocked(b), ["REFERENCE_CONTEXT_NOT_RECONCILED"]);
});

test("a manifest may hash a partial outcome set but must not call every decision linked", () => {
  const second: RuntimeDecisionLedgerRecord = {
    ...decision(), recordId: "synthetic-decision-record-2",
    decisionId: "synthetic-decision-2", canonicalRaceId: "synthetic-race-2",
  };
  const b = bundle([decision(), second], [outcome()]);
  assert.deepEqual(blocked(b), ["UNMATCHED_DECISION_RECORDS"]);
  assert.equal(check(b).outcomeReferencesLinked, false);
  assert.equal(check(b).scoringAuthorized, false);
});

test("complete two-decision/two-outcome synthetic linkage stays research-only", () => {
  const second: RuntimeDecisionLedgerRecord = {
    ...decision(), recordId: "synthetic-decision-record-2",
    decisionId: "synthetic-decision-2", canonicalRaceId: "synthetic-race-2",
  };
  const secondOutcome: OutcomeLearningLedgerRecord = {
    ...outcome(), outcomeRecordId: "synthetic-outcome-record-2",
    decisionRecordId: second.recordId, decisionId: second.decisionId,
    canonicalRaceId: second.canonicalRaceId, settlementId: "synthetic-settlement-2",
  };
  const assessment = check(bundle([decision(), second], [outcome(), secondOutcome]));
  assert.equal(assessment.outcomeReferencesLinked, true);
  assert.equal(assessment.excludedOutcomePresent, false);
  assert.equal(assessment.scoringAuthorized, false);
  assert.deepEqual(assessment.blockers, [
    "UNAPPROVED_PROTOCOL", "INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED",
    "PROSPECTIVE_ENROLLMENT_NOT_ATTESTED",
  ]);
});

test("late reference-descriptor repair cannot rewrite an earlier decision identity", () => {
  const b = bundle();
  b.d[0]!.decisionId = "synthetic-initially-invalid-decision";
  let repaired = false;
  b.r = new Proxy(b.r, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "expectedAnalysisSnapshotDigest") {
        repaired = true;
        b.d[0]!.decisionId = "synthetic-decision";
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = check(b);
  assert.equal(repaired, true, "reference descriptor trap must execute");
  assert.equal(result.outcomeReferencesLinked, false);
  assert.deepEqual(result.blockers, ["DECISION_DIGEST_MISMATCH"]);
  assert.equal(result.scoringAuthorized, false);
});

test("late reference-descriptor repair cannot rewrite an earlier outcome linkage", () => {
  const b = bundle();
  b.o[0]!.decisionRecordId = "synthetic-initially-invalid-record";
  let repaired = false;
  b.r = new Proxy(b.r, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "expectedAnalysisSnapshotDigest") {
        repaired = true;
        b.o[0]!.decisionRecordId = "synthetic-decision-record";
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = check(b);
  assert.equal(repaired, true, "reference descriptor trap must execute");
  assert.equal(result.outcomeReferencesLinked, false);
  assert.deepEqual(result.blockers, ["OUTCOME_DIGEST_MISMATCH"]);
  assert.equal(result.scoringAuthorized, false);
});

test("cross-ledger assessments cannot be rewritten after either outcome", () => {
  const valid = check(bundle());
  const invalid = bundle();
  invalid.c.scoringAuthorized = true;
  const denied = check(invalid);
  for (const result of [valid, denied]) {
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.blockers), true);
    assert.equal(result.scoringAuthorized, false);
    assert.throws(() => {
      (result as unknown as { scoringAuthorized: boolean }).scoringAuthorized = true;
    }, TypeError);
    assert.throws(() => {
      (result.blockers as unknown as string[]).push("FAKE_AUTHORITY");
    }, TypeError);
    assert.equal(result.scoringAuthorized, false);
  }
  assert.equal(valid.outcomeReferencesLinked, true);
  assert.equal(denied.outcomeReferencesLinked, false);
});
