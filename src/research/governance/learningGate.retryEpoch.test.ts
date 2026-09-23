import assert from "node:assert/strict";
import test from "node:test";

import type { LearningRecord } from "./contracts";
import { detectLearningRetryViolations } from "./learningGate";

const base: LearningRecord = {
  learningId: "LEARN-epoch-failure-1",
  classification: "NEW_FAILURE",
  fingerprintKey: "research.registry.retry-epoch",
  subsystem: "research-governance",
  operation: "detect-learning-retry-violations",
  symptom: "unchanged attempt failed",
  rootCauseClass: "UNCHANGED_FAILURE",
  attemptSignature: "method-a",
  authorityState: {
    mainSha: "0123456789abcdef0123456789abcdef01234567",
    environmentKey: "ci",
    materialStateKey: "learning-gate-v2",
  },
  evidenceRefs: ["github-actions/failure"],
  lesson: "do not repeat unchanged failures",
  guardrail: "switch after one failure and block after two",
  repeatPolicy: "BLOCK_SAME_ATTEMPT_UNTIL_CHANGE",
  createdAt: "2026-09-18T01:00:00.000Z",
  productionConnection: false,
};

const secondFailure: LearningRecord = {
  ...base,
  learningId: "LEARN-epoch-failure-2",
  createdAt: "2026-09-18T02:00:00.000Z",
};

const verifiedSuccess: LearningRecord = {
  ...base,
  learningId: "LEARN-epoch-success",
  classification: "VERIFIED_SUCCESS",
  symptom: "changed method was verified",
  rootCauseClass: "VERIFIED_RECOVERY",
  lesson: "verified recovery starts a new retry epoch",
  guardrail: "reuse verified method until a newer failure",
  repeatPolicy: "REUSE_VERIFIED_GUARDRAIL",
  createdAt: "2026-09-18T03:00:00.000Z",
};

const failureAfterSuccess: LearningRecord = {
  ...base,
  learningId: "LEARN-epoch-failure-after-success",
  createdAt: "2026-09-18T04:00:00.000Z",
};

test("verified success starts a new retry epoch for violation detection", () => {
  const violations = detectLearningRetryViolations([
    base,
    secondFailure,
    verifiedSuccess,
    failureAfterSuccess,
  ]);
  assert.deepEqual(violations, []);
});

test("three failures within one retry epoch remain a violation", () => {
  const thirdFailure: LearningRecord = {
    ...base,
    learningId: "LEARN-epoch-failure-3",
    createdAt: "2026-09-18T02:30:00.000Z",
  };
  const violations = detectLearningRetryViolations([base, secondFailure, thirdFailure]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /3 unchanged failures/);
});
