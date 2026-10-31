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


import {
  assessForwardV02OutcomeLinkPreflightStrictNodeIngress as strictLink,
  assessForwardV02LinkedBuyRaceParityStrictNodeIngress as strictBuy,
  assessForwardV02LocalOutcomeRaceParityStrictNodeIngress as strictLocal,
} from "./forwardV02OutcomeAndParityStrictNodeIngress";

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


const aligned = () => bundle([
  decision("synthetic-a", "1", "a1"),
  decision("synthetic-b", "1", "b1"),
]);
const inputs = (b: ReturnType<typeof bundle>) =>
  [b.c, b.r, b.ds, b.os] as const;

test("strict outcome and both parity ingresses preserve plain-data legacy decisions, never scoring", () => {
  const b = aligned();
  assert.deepEqual(strictLink(...inputs(b)), assessForwardV02OutcomeLinkPreflight(...inputs(b)));
  assert.deepEqual(strictBuy(...inputs(b)), assessForwardV02LinkedBuyRaceParity(...inputs(b)));
  assert.deepEqual(strictLocal(...inputs(b)), assessForwardV02LocalOutcomeRaceParity(...inputs(b)));
  assert.equal(strictLink(...inputs(b)).scoringAuthorized, false);
  assert.equal(strictBuy(...inputs(b)).scoringAuthorized, false);
  assert.equal(strictLocal(...inputs(b)).scoringAuthorized, false);
  assert.equal(strictLink(...inputs(b)).outcomeReferencesLinked, true);
  assert.equal(strictBuy(...inputs(b)).linkedBuyRaceSetsAligned, true);
  assert.equal(strictLocal(...inputs(b)).localOutcomeRaceSetsAligned, true);
});

test("strict parity rejects unequal race sets despite valid caller-supplied digests", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-b", "2", "b2"),
  ]);
  assert.deepEqual(strictBuy(...inputs(b)).blockers, ["UNEQUAL_LINKED_BUY_RACE_SETS"]);
  assert.deepEqual(strictLocal(...inputs(b)).blockers, ["LINKED_BUY_RACE_PARITY_NOT_VERIFIED"]);
  assert.equal(strictLink(...inputs(b)).outcomeReferencesLinked, true);
});

test("root reference Proxy cannot repair an unequal race before any strict ingress", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-b", "2", "b2"),
  ]);
  let traps = 0;
  b.r = new Proxy(b.r, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      b.ds[1]!.canonicalRaceId = "synthetic-race-1";
      b.os[1]!.canonicalRaceId = "synthetic-race-1";
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(strictLink(...inputs(b)).blockers, ["REFERENCE_CONTEXT_NOT_RECONCILED"]);
  assert.deepEqual(strictBuy(...inputs(b)).blockers, ["OUTCOME_LINK_NOT_VERIFIED"]);
  assert.deepEqual(strictLocal(...inputs(b)).blockers, ["LINKED_BUY_RACE_PARITY_NOT_VERIFIED"]);
  assert.equal(traps, 0);
  assert.equal(b.ds[1]!.canonicalRaceId, "synthetic-race-2");
});

test("nested decision Proxy cannot repair a later outcome or manifest", () => {
  const b = aligned();
  b.os[0]!.payoutYen = 999;
  let traps = 0;
  b.ds[0] = new Proxy(b.ds[0]!, {
    getPrototypeOf(target) {
      traps++;
      b.os[0]!.payoutYen = 200;
      return Reflect.getPrototypeOf(target);
    },
  });
  assert.deepEqual(strictLink(...inputs(b)).blockers, ["INVALID_LEDGER_COLLECTION"]);
  assert.deepEqual(strictBuy(...inputs(b)).blockers, ["OUTCOME_LINK_NOT_VERIFIED"]);
  assert.equal(traps, 0);
  assert.equal(b.os[0]!.payoutYen, 999);
});

test("later outcome Proxy cannot repair earlier unequal decision races", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-b", "2", "b2"),
  ]);
  let traps = 0;
  b.os[1] = new Proxy(b.os[1]!, {
    ownKeys(target) {
      traps++;
      b.ds[1]!.canonicalRaceId = "synthetic-race-1";
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(strictLink(...inputs(b)).blockers, ["INVALID_LEDGER_COLLECTION"]);
  assert.deepEqual(strictLocal(...inputs(b)).blockers, ["LINKED_BUY_RACE_PARITY_NOT_VERIFIED"]);
  assert.equal(traps, 0);
  assert.equal(b.ds[1]!.canonicalRaceId, "synthetic-race-2");
});

test("revoked nested manifest Proxy and accessor are rejected without caller traps", () => {
  const b = aligned();
  let traps = 0;
  const revoked = Proxy.revocable(b.r.sourceManifest.decisionDigests, {
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
  });
  revoked.revoke();
  b.r.sourceManifest.decisionDigests = revoked.proxy;
  assert.deepEqual(strictLink(...inputs(b)).blockers, ["REFERENCE_CONTEXT_NOT_RECONCILED"]);
  assert.deepEqual(strictBuy(...inputs(b)).blockers, ["OUTCOME_LINK_NOT_VERIFIED"]);
  assert.equal(traps, 0);

  const c = aligned();
  let getters = 0;
  Object.defineProperty(c.os[0]!, "payoutYen", {
    enumerable: true, configurable: true,
    get() { getters++; return 200; },
  });
  assert.deepEqual(strictLink(...inputs(c)).blockers, ["INVALID_LEDGER_COLLECTION"]);
  assert.equal(getters, 0);
});

test("ledger capture failures take precedence over simultaneous reference failures", () => {
  const b = aligned();
  let traps = 0;
  b.ds = new Proxy(b.ds, {
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
  });
  b.r = new Proxy(b.r, {
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
  });
  assert.deepEqual(strictLink(...inputs(b)).blockers, ["INVALID_LEDGER_COLLECTION"]);
  assert.deepEqual(strictBuy(...inputs(b)).blockers, ["OUTCOME_LINK_NOT_VERIFIED"]);
  assert.deepEqual(strictLocal(...inputs(b)).blockers, ["LINKED_BUY_RACE_PARITY_NOT_VERIFIED"]);
  assert.equal(traps, 0);
});

test("symmetric excluded local outcomes retain legacy parity but never gain scoring authority", () => {
  const b = bundle([
    decision("synthetic-a", "1", "a1"), decision("synthetic-a", "2", "a2"),
    decision("synthetic-b", "1", "b1"), decision("synthetic-b", "2", "b2"),
  ], os => {
    for (const i of [1, 3]) {
      const o = os[i]!;
      o.disposition = "REFUNDED"; o.evaluable = false;
      o.payoutYen = 0; o.refundYen = 100; o.refundReason = "synthetic-refund";
    }
  });
  assert.deepEqual(strictLocal(...inputs(b)), assessForwardV02LocalOutcomeRaceParity(...inputs(b)));
  assert.equal(strictLocal(...inputs(b)).localOutcomeRaceSetsAligned, true);
  assert.equal(strictLocal(...inputs(b)).scoringAuthorized, false);
});

test("strict Node ingress denial and delegated assessments remain immutable", () => {
  const valid = aligned();
  const blocked = aligned();
  blocked.ds = new Proxy(blocked.ds, {});
  const results = [
    strictLink(...inputs(valid)), strictBuy(...inputs(valid)), strictLocal(...inputs(valid)),
    strictLink(...inputs(blocked)), strictBuy(...inputs(blocked)), strictLocal(...inputs(blocked)),
  ];
  for (const result of results) {
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
  assert.deepEqual(results[3]!.blockers, ["INVALID_LEDGER_COLLECTION"]);
  assert.deepEqual(results[4]!.blockers, ["OUTCOME_LINK_NOT_VERIFIED"]);
  assert.deepEqual(results[5]!.blockers, ["LINKED_BUY_RACE_PARITY_NOT_VERIFIED"]);
});
