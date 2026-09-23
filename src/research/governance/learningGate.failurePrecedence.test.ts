import assert from "node:assert/strict";
import test from "node:test";

import type { LearningRecord } from "./contracts";
import { evaluateLearningGate } from "./learningGate";

const success: LearningRecord = {
  learningId: "LEARN-success-before-failure",
  classification: "VERIFIED_SUCCESS",
  fingerprintKey: "research.registry.failure-precedence",
  subsystem: "research-governance",
  operation: "evaluate-learning-gate",
  symptom: "method was verified before a later regression",
  rootCauseClass: "VERIFIED_BEFORE_REGRESSION",
  attemptSignature: "method-a",
  authorityState: {
    mainSha: "0123456789abcdef0123456789abcdef01234567",
    environmentKey: "ci",
    materialStateKey: "learning-gate-v2",
  },
  evidenceRefs: ["github-actions/success"],
  lesson: "reuse while it remains the latest decisive learning",
  guardrail: "use method-a",
  repeatPolicy: "REUSE_VERIFIED_GUARDRAIL",
  createdAt: "2026-09-18T02:00:00.000Z",
  productionConnection: false,
};

const failure: LearningRecord = {
  ...success,
  learningId: "LEARN-failure-after-success",
  classification: "NEW_FAILURE",
  symptom: "same normalized method later failed",
  rootCauseClass: "REGRESSION_AFTER_VERIFIED_SUCCESS",
  lesson: "a later failure invalidates blind reuse",
  guardrail: "switch method after the later unchanged failure",
  repeatPolicy: "BLOCK_SAME_ATTEMPT_UNTIL_CHANGE",
  createdAt: "2026-09-18T03:00:00.000Z",
};

const attempt = {
  fingerprintKey: success.fingerprintKey,
  attemptSignature: success.attemptSignature,
  authorityState: success.authorityState,
};

test("a later unchanged failure supersedes an older verified-success guardrail", () => {
  const decision = evaluateLearningGate([success, failure], attempt);
  assert.equal(decision.action, "SWITCH_METHOD");
  if (decision.action === "SWITCH_METHOD") assert.equal(decision.learningId, failure.learningId);
});

test("two failures after the latest verified success block the third identical attempt", () => {
  const secondFailure: LearningRecord = {
    ...failure,
    learningId: "LEARN-second-failure-after-success",
    createdAt: "2026-09-18T04:00:00.000Z",
  };
  const decision = evaluateLearningGate([success, failure, secondFailure], attempt);
  assert.equal(decision.action, "BLOCK_REPEAT");
  if (decision.action === "BLOCK_REPEAT") assert.equal(decision.learningId, secondFailure.learningId);
});
