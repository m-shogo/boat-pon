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
import { assessForwardV02LinkedBuyRaceParity, assessForwardV02LocalOutcomeRaceParity } from "./forwardV02LinkedBuyRaceParity";
import { assessForwardV02OutcomeLinkPreflight } from "./forwardV02OutcomeLinkPreflight";

const h = (c: string) => c.repeat(64);

function decision(
  system: string, race: string, id: string, selection = "1-2-3",
): RuntimeDecisionLedgerRecord {
  return {
    schemaVersion: "runtime-decision-ledger.0.1",
    recordId: `synthetic-record-${id}`, decisionId: `synthetic-decision-${id}`,
    canonicalRaceId: `synthetic-race-${race}`, sourceDecisionHistoryId: null,
    decisionSystem: system, strategyVersion: "synthetic-v1",
    modelVersion: "synthetic-v1", featureVersion: "synthetic-v1",
    manifestId: `synthetic-enrollment-${system}`, cohortId: "synthetic-shared-cohort",
    evaluationMode: "shadow_forward", ticketType: "trifecta", selection,
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

function outcome(d: RuntimeDecisionLedgerRecord): OutcomeLearningLedgerRecord {
  return {
    schemaVersion: "outcome-learning-ledger.0.1",
    outcomeRecordId: `synthetic-outcome-${d.recordId}`,
    decisionRecordId: d.recordId, decisionId: d.decisionId,
    canonicalRaceId: d.canonicalRaceId, ticketType: d.ticketType,
    selection: d.selection, settlementId: `synthetic-settlement-${d.recordId}`,
    settledAt: "2026-10-24T00:00:03Z",
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
    schemaVersion: FORWARD_V02_CANDIDATE_VERSION,
    kind: "EVALUATION_PROTOCOL", protocolId: "synthetic-v02",
    protocolVersion: "0.2-candidate", status: "UNAPPROVED",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-10-23T00:00:00Z",
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

function bundle(ds: RuntimeDecisionLedgerRecord[], editOutcomes?: (rows: OutcomeLearningLedgerRecord[]) => void) {
  const c = candidate();
  const os = ds.map(outcome);
  editOutcomes?.(os);
  const m = {
    schemaVersion: "forward-source-manifest.0.2-candidate",
    manifestId: "synthetic-source-manifest", evidenceStage: c.evidenceStage,
    analysisSnapshotDigest: h("b"),
    decisionDigests: ds.map(runtimeDecisionLedgerDigest),
    outcomeDigests: os.map(outcomeLearningLedgerDigest),
    createdAt: "2026-10-24T00:00:04Z", productionConnection: false,
  };
  const digest = forwardV02SourceManifestReferenceDigest(m)!;
  const r = {
    formula: formula(), formulaDigest: forwardV02FormulaReferenceDigest(formula())!,
    sourceManifest: m, expectedSourceManifestDigest: digest,
    resultSourceManifestDigest: digest, expectedAnalysisSnapshotDigest: h("b"),
  };
  return { c, r, ds, os };
}

type Bundle = ReturnType<typeof bundle>;
function check(b: Bundle) {
  return assessForwardV02LinkedBuyRaceParity(b.c, b.r, b.ds, b.os);
}
function reason(b: Bundle) {
  return check(b).blockers;
}
const aligned = () => bundle([
  decision("synthetic-a", "1", "a1"),
  decision("synthetic-b", "1", "b1"),
]);

test("two benchmark systems with the same linked BUY race remain unauthorized", () => {
  assert.deepEqual(check(aligned()), {
    linkedBuyRaceSetsAligned: true, scoringAuthorized: false,
    blockers: [
      "UNAPPROVED_PROTOCOL", "PROSPECTIVE_COHORT_NOT_ATTESTED",
      "INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED",
      "ELIGIBLE_DENOMINATORS_AND_EXCLUSIONS_NOT_VERIFIED",
    ],
  });
});

test("a missing benchmark system is not an aligned common cohort", () => {
  assert.deepEqual(reason(bundle([decision("synthetic-a", "1", "a1")])),
    ["MISSING_BENCHMARK_DECISION_SYSTEM"]);
});

test("equal-sized but different race sets fail closed", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-b", "2", "b2"),
  ]);
  assert.deepEqual(reason(b), ["UNEQUAL_LINKED_BUY_RACE_SETS"]);
});

test("content-consistent ledgers do not prove cross-system race parity", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-b", "2", "b2"),
  ]);
  assert.equal(
    assessForwardV02OutcomeLinkPreflight(b.c, b.r, b.ds, b.os).outcomeReferencesLinked,
    true,
  );
  assert.deepEqual(reason(b), ["UNEQUAL_LINKED_BUY_RACE_SETS"]);
  assert.equal(check(b).scoringAuthorized, false);
});

test("extra race on one system fails closed", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-a", "2", "a2"),
    decision("synthetic-b", "1", "b1"),
  ]);
  assert.deepEqual(reason(b), ["UNEQUAL_LINKED_BUY_RACE_SETS"]);
});

test("same race set with different cohort IDs fails closed", () => {
  const ds = [
    decision("synthetic-a", "1", "a1"),
    { ...decision("synthetic-b", "1", "b1"), cohortId: "other-cohort" },
  ];
  assert.deepEqual(reason(bundle(ds)), ["MIXED_COHORT_IDENTITIES"]);
});

test("undeclared third decision system cannot enter the comparison", () => {
  const ds = [
    decision("synthetic-a", "1", "a1"), decision("synthetic-b", "1", "b1"),
    decision("synthetic-c", "1", "c1"),
  ];
  assert.deepEqual(reason(bundle(ds)), ["UNDECLARED_DECISION_SYSTEM"]);
});

test("multiple tickets on one race do not become an artificial race mismatch", () => {
  const ds = [
    decision("synthetic-a", "1", "a1", "1-2-3"),
    decision("synthetic-a", "1", "a2", "1-3-2"),
    decision("synthetic-b", "1", "b1"),
  ];
  const result = check(bundle(ds));
  assert.equal(result.linkedBuyRaceSetsAligned, true);
  assert.equal(result.scoringAuthorized, false);
  assert.ok(result.blockers.includes("ELIGIBLE_DENOMINATORS_AND_EXCLUSIONS_NOT_VERIFIED"));
});

test("equal multi-race coverage remains aligned despite record ordering", () => {
  const ds = [
    decision("synthetic-b", "2", "b2"), decision("synthetic-a", "1", "a1"),
    decision("synthetic-b", "1", "b1"), decision("synthetic-a", "2", "a2"),
  ];
  assert.equal(check(bundle(ds)).linkedBuyRaceSetsAligned, true);
  assert.equal(check(bundle([...ds].reverse())).linkedBuyRaceSetsAligned, true);
});

test("SELECTED_RACE is never relabeled as COMMON_COHORT", () => {
  const b = aligned(); b.c.comparisonMode = "SELECTED_RACE";
  assert.deepEqual(reason(b), ["NOT_COMMON_COHORT_PROTOCOL"]);
});

test("one benchmark system is insufficient for cross-system parity", () => {
  const b = aligned(); b.c.benchmarkDecisionSystems = ["synthetic-a"];
  assert.deepEqual(reason(b), ["INSUFFICIENT_BENCHMARK_SYSTEMS"]);
});

test("tampered outcome or manifest cannot reach the parity check", () => {
  const b = aligned(); b.os[0]!.payoutYen++;
  assert.deepEqual(reason(b), ["OUTCOME_LINK_NOT_VERIFIED"]);
  const m = aligned(); m.r.expectedSourceManifestDigest = h("f");
  assert.deepEqual(reason(m), ["OUTCOME_LINK_NOT_VERIFIED"]);
});

test("a malformed or accessor-backed collection is rejected before parity", () => {
  const b = aligned();
  Object.defineProperty(b.ds, "0", { get() { throw Error("must not read"); } });
  assert.deepEqual(reason(b), ["OUTCOME_LINK_NOT_VERIFIED"]);
});

test("unsupported holdout stage cannot be inferred from shadow decisions", () => {
  const b = aligned(); b.c.evidenceStage = "UNTOUCHED_HOLDOUT";
  b.r.sourceManifest.evidenceStage = "UNTOUCHED_HOLDOUT";
  const digest = forwardV02SourceManifestReferenceDigest(b.r.sourceManifest)!;
  b.r.expectedSourceManifestDigest = digest;
  b.r.resultSourceManifestDigest = digest;
  assert.deepEqual(reason(b), ["OUTCOME_LINK_NOT_VERIFIED"]);
});


function localReason(b: Bundle) {
  return assessForwardV02LocalOutcomeRaceParity(b.c, b.r, b.ds, b.os).blockers;
}
function refund(o: OutcomeLearningLedgerRecord) {
  o.disposition = "REFUNDED";
  o.evaluable = false;
  o.payoutYen = 0;
  o.refundYen = 100;
  o.refundReason = "synthetic-refund";
}

test("aligned locally settled and excluded race sets remain unauthorized", () => {
  assert.deepEqual(assessForwardV02LocalOutcomeRaceParity(
    aligned().c, aligned().r, aligned().ds, aligned().os,
  ).blockers, [
    "UNAPPROVED_PROTOCOL", "PROSPECTIVE_COHORT_NOT_ATTESTED",
    "INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED",
    "TICKET_STAKE_AND_FROZEN_EXCLUSION_POLICY_NOT_VERIFIED",
  ]);
  const b = aligned();
  const result = assessForwardV02LocalOutcomeRaceParity(b.c, b.r, b.ds, b.os);
  assert.equal(result.localOutcomeRaceSetsAligned, true);
  assert.equal(result.scoringAuthorized, false);
});

test("equal linked BUY races with asymmetric refund cannot pass local settlement parity", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-b", "1", "b1"),
  ], (os) => refund(os[1]!));
  assert.equal(check(b).linkedBuyRaceSetsAligned, true);
  assert.deepEqual(localReason(b), ["UNEQUAL_LOCAL_SETTLED_RACE_SETS"]);
});

test("both systems entirely refunded do not produce vacuous local parity", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-b", "1", "b1"),
  ], (os) => { refund(os[0]!); refund(os[1]!); });
  assert.deepEqual(localReason(b), ["NO_LOCALLY_SETTLED_RACES"]);
});

test("different settled race sets with equal cardinality are rejected", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-a", "2", "a2"),
    decision("synthetic-b", "1", "b1"), decision("synthetic-b", "2", "b2"),
  ], (os) => { refund(os[1]!); refund(os[2]!); });
  assert.deepEqual(localReason(b), ["UNEQUAL_LOCAL_SETTLED_RACE_SETS"]);
});

test("extra excluded ticket on a shared settled race remains visible", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1", "1-2-3"),
    decision("synthetic-a", "1", "a2", "1-3-2"),
    decision("synthetic-b", "1", "b1"),
  ], (os) => refund(os[1]!));
  assert.deepEqual(localReason(b), ["UNEQUAL_LOCAL_EXCLUSION_RACE_SETS"]);
});

test("symmetric local refund exclusions are retained, never scored", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-a", "2", "a2"),
    decision("synthetic-b", "1", "b1"), decision("synthetic-b", "2", "b2"),
  ], (os) => { refund(os[1]!); refund(os[3]!); });
  const result = assessForwardV02LocalOutcomeRaceParity(b.c, b.r, b.ds, b.os);
  assert.equal(result.localOutcomeRaceSetsAligned, true);
  assert.equal(result.scoringAuthorized, false);
  assert.ok(result.blockers.includes("INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED"));
});

test("zero-stake locally settled record is not treated as an eligible denominator", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-b", "1", "b1"),
  ], (os) => { os[0]!.stakeYen = 0; });
  assert.deepEqual(localReason(b), ["NONPOSITIVE_LOCAL_SETTLED_STAKE"]);
});

test("tampered outcome cannot bypass the linked-ledger preflight", () => {
  const b = aligned();
  b.os[0]!.payoutYen++;
  assert.deepEqual(localReason(b), ["LINKED_BUY_RACE_PARITY_NOT_VERIFIED"]);
});

test("unequal initial BUY race sets are rejected before local outcome parity", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-b", "2", "b2"),
  ]);
  assert.deepEqual(localReason(b), ["LINKED_BUY_RACE_PARITY_NOT_VERIFIED"]);
});

test("late reference repair cannot equalize initially unequal linked BUY race sets", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"),
    decision("synthetic-b", "2", "b2"),
  ]);
  let repaired = false;
  b.r = new Proxy(b.r, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "expectedAnalysisSnapshotDigest") {
        repaired = true;
        b.ds[1]!.canonicalRaceId = "synthetic-race-1";
        b.os[1]!.canonicalRaceId = "synthetic-race-1";
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = check(b);
  assert.equal(repaired, true, "late reference descriptor must execute");
  assert.equal(result.linkedBuyRaceSetsAligned, false);
  assert.deepEqual(result.blockers, ["UNEQUAL_LINKED_BUY_RACE_SETS"]);
  assert.equal(result.scoringAuthorized, false);
});

test("late reference repair cannot hide an initially asymmetric local refund", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"),
    decision("synthetic-b", "1", "b1"),
  ], (os) => refund(os[1]!));
  let repaired = false;
  b.r = new Proxy(b.r, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "expectedAnalysisSnapshotDigest") {
        repaired = true;
        const o = b.os[1]!;
        o.disposition = "SETTLED";
        o.evaluable = true;
        o.payoutYen = 200;
        o.refundYen = 0;
        o.refundReason = null;
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = assessForwardV02LocalOutcomeRaceParity(b.c, b.r, b.ds, b.os);
  assert.equal(repaired, true, "late reference descriptor must execute");
  assert.equal(result.localOutcomeRaceSetsAligned, false);
  assert.deepEqual(result.blockers, ["UNEQUAL_LOCAL_SETTLED_RACE_SETS"]);
  assert.equal(result.scoringAuthorized, false);
});

test("linked and local race-parity results remain deny-only under runtime mutation", () => {
  const good = aligned();
  const mismatch = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-b", "2", "b2"),
  ]);
  const assessments = [
    check(good),
    check(mismatch),
    assessForwardV02LocalOutcomeRaceParity(good.c, good.r, good.ds, good.os),
    assessForwardV02LocalOutcomeRaceParity(mismatch.c, mismatch.r, mismatch.ds, mismatch.os),
  ];
  for (const result of assessments) {
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
  assert.equal(assessments[0]!.scoringAuthorized, false);
  assert.equal(assessments[2]!.scoringAuthorized, false);
});
