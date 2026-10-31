import assert from "node:assert/strict";
import test from "node:test";
import {
  assessForwardV02Candidate, FORWARD_V02_CANDIDATE_VERSION,
} from "./forwardEvaluationProtocolV02Candidate";
import { assessForwardV02CandidateStrictNodeIngress as strict } from "./forwardV02CandidateStrictNodeIngress";

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
    samplePolicy: {
      minDecisions: 1, minRaces: 1, grouping: "PER_STAGE_PER_DECISION_SYSTEM",
    },
    exclusionReasons: [
      "REFUNDED", "VOID", "CANCELLED", "UNRESOLVED", "NONFINAL",
      "NOT_EVALUABLE", "IDENTITY_MISMATCH", "NOT_ENROLLED", "SPECIAL_PAYOUT",
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


test("strict candidate ingress preserves unapproved ordinary-candidate parity", () => {
  const c = candidate();
  assert.deepEqual(strict(c), assessForwardV02Candidate(c));
  assert.equal(strict(c).candidateComplete, true);
  assert.equal(strict(c).scoringAuthorized, false);
  assert.deepEqual(strict({ ...c, status: "APPROVED" }).blockers, ["INVALID_CANDIDATE_HEADER"]);
});

test("root candidate Proxy cannot repair an initially invalid evidence stage", () => {
  const c = candidate();
  c.evidenceStage = "INVALID";
  let traps = 0;
  const input = new Proxy(c, {
    ownKeys(target) {
      traps++;
      c.evidenceStage = "SHADOW_FORWARD";
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(strict(input).blockers, ["INVALID_CANDIDATE_SHAPE"]);
  assert.equal(traps, 0);
  assert.equal(c.evidenceStage, "INVALID");
});

test("nested money-policy Proxy cannot repair missing evidence requirements", () => {
  const c = candidate();
  c.evidenceRequirements.enrollment = "POST_HOC";
  let traps = 0;
  c.moneyPolicy = new Proxy(c.moneyPolicy, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      c.evidenceRequirements.enrollment = "PROSPECTIVE_FROZEN_BEFORE_DECISION";
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(strict(c).blockers, ["INVALID_CANDIDATE_SHAPE"]);
  assert.equal(traps, 0);
  assert.equal(c.evidenceRequirements.enrollment, "POST_HOC");
});

test("nested benchmark array Proxy cannot repair missing exclusions", () => {
  const c = candidate();
  c.exclusionReasons.pop();
  let traps = 0;
  c.benchmarkDecisionSystems = new Proxy(c.benchmarkDecisionSystems, {
    getPrototypeOf(target) {
      traps++;
      c.exclusionReasons.push("NOT_ENROLLED");
      return Reflect.getPrototypeOf(target);
    },
  });
  assert.deepEqual(strict(c).blockers, ["INVALID_CANDIDATE_SHAPE"]);
  assert.equal(traps, 0);
  assert.equal(c.exclusionReasons.length, 7);
});

test("revoked nested Proxy and accessor are rejected without trap or getter", () => {
  const c = candidate();
  let traps = 0;
  const revoked = Proxy.revocable(c.exclusionReasons, {
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
  });
  revoked.revoke();
  c.exclusionReasons = revoked.proxy;
  assert.deepEqual(strict(c).blockers, ["INVALID_CANDIDATE_SHAPE"]);
  assert.equal(traps, 0);

  const d = candidate();
  let getters = 0;
  Object.defineProperty(d, "status", {
    enumerable: true, configurable: true,
    get() { getters++; return "UNAPPROVED"; },
  });
  assert.deepEqual(strict(d).blockers, ["INVALID_CANDIDATE_SHAPE"]);
  assert.equal(getters, 0);
});

test("strict candidate ingress returns runtime-immutable deny-only results", () => {
  const c = candidate();
  const rejected = strict(new Proxy(c, {}));
  assert.deepEqual(rejected.blockers, ["INVALID_CANDIDATE_SHAPE"]);

  const assessments = [
    rejected,
    strict({ ...c, status: "APPROVED" }),
    strict(c),
  ];
  for (const assessment of assessments) {
    assert.equal(assessment.scoringAuthorized, false);
    assert.equal(Object.isFrozen(assessment), true);
    assert.equal(Object.isFrozen(assessment.blockers), true);
    const originalBlockers = [...assessment.blockers];
    const originalComplete = assessment.candidateComplete;
    assert.throws(() => {
      (assessment as unknown as { scoringAuthorized: boolean }).scoringAuthorized = true;
    }, TypeError);
    assert.throws(() => {
      (assessment as unknown as { candidateComplete: boolean }).candidateComplete = !originalComplete;
    }, TypeError);
    assert.throws(() => {
      (assessment.blockers as string[]).push("SCORING_APPROVED");
    }, TypeError);
    assert.throws(() => {
      (assessment.blockers as string[])[0] = "SCORING_APPROVED";
    }, TypeError);
    assert.equal(assessment.scoringAuthorized, false);
    assert.equal(assessment.candidateComplete, originalComplete);
    assert.deepEqual(assessment.blockers, originalBlockers);
  }
});
