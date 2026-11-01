import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type AnalysisSnapshot,
  type Membership,
} from "./forwardEvaluationVault.js";

// Synthetic research metadata only: no private odds, K evidence, N2 or production inputs.
const sha = "a".repeat(64);
const createdAt = "2026-11-02T00:00:00Z";
const membership = (reason: string): Membership => ({
  schemaVersion: V, kind: "MEMBERSHIP", recordId: "synthetic:factory-member",
  evidenceStage: "SHADOW_FORWARD", createdAt,
  cohortId: "synthetic:cohort", enrollmentProtocolId: "synthetic:enroll",
  enrollmentProtocolDigest: sha, canonicalRaceId: "synthetic:race",
  decisionRecordId: "synthetic:decision", decisionRecordDigest: sha,
  enrolledAt: createdAt, included: true, reason,
});
const snapshot = (digest: string): AnalysisSnapshot => ({
  schemaVersion: V, kind: "ANALYSIS_SNAPSHOT", recordId: "synthetic:factory-snapshot",
  evidenceStage: "SHADOW_FORWARD", createdAt,
  analysisSnapshotId: "synthetic:snapshot", cohortId: "synthetic:cohort",
  cutoffAt: createdAt, membershipDigests: [digest],
});

test("v0.1 validation retains denial errors under ambient Object.defineProperty no-op", () => {
  const invalid = { ...membership("synthetic"), included: "not-a-boolean" };
  assert.equal(validateForwardVaultRecord(invalid).valid, false);
  const original = Object.getOwnPropertyDescriptor(Object, "defineProperty");
  assert.ok(original);
  const nativeDefine = Object.defineProperty;
  let observed: { valid: boolean; errors: string[]; append: string; digestRejected: boolean } | undefined;
  try {
    nativeDefine(Object, "defineProperty", {
      ...original,
      value: ((_target: object) => _target) as typeof Object.defineProperty,
    });
    const verdict = validateForwardVaultRecord(invalid);
    let digestRejected = false;
    try { forwardVaultDigest(invalid as unknown as Membership); }
    catch (error) { digestRejected = error instanceof TypeError; }
    observed = {
      valid: verdict.valid,
      errors: [...verdict.errors],
      append: classifyForwardVaultAppend(undefined, invalid),
      digestRejected,
    };
  } finally {
    nativeDefine(Object, "defineProperty", original);
  }
  assert.deepEqual(observed, {
    valid: false, errors: ["included must be boolean"],
    append: "REJECTED_INVALID", digestRejected: true,
  });
});

test("v0.1 canonical arrays retain distinct digest identities under no-op Object.defineProperty", () => {
  const before = snapshot(sha);
  const after = snapshot("b".repeat(64));
  const expectedBefore = forwardVaultDigest(before);
  const expectedAfter = forwardVaultDigest(after);
  assert.notEqual(expectedBefore, expectedAfter);
  const original = Object.getOwnPropertyDescriptor(Object, "defineProperty");
  assert.ok(original);
  const nativeDefine = Object.defineProperty;
  let observed: { before: string; after: string; append: string } | undefined;
  try {
    nativeDefine(Object, "defineProperty", {
      ...original,
      value: ((_target: object) => _target) as typeof Object.defineProperty,
    });
    observed = {
      before: forwardVaultDigest(before),
      after: forwardVaultDigest(after),
      append: classifyForwardVaultAppend(before, after),
    };
  } finally {
    nativeDefine(Object, "defineProperty", original);
  }
  assert.deepEqual(observed, {
    before: expectedBefore, after: expectedAfter, append: "CONFLICT",
  });
});

test("v0.1 canonical objects reject ambient Object.create toJSON digest alias", () => {
  const before = membership("synthetic:before");
  const after = membership("synthetic:after");
  const expectedBefore = forwardVaultDigest(before);
  const expectedAfter = forwardVaultDigest(after);
  assert.notEqual(expectedBefore, expectedAfter);
  const original = Object.getOwnPropertyDescriptor(Object, "create");
  assert.ok(original);
  const nativeDefine = Object.defineProperty;
  let toJsonCalls = 0;
  let observed: { before: string; after: string; append: string } | undefined;
  try {
    nativeDefine(Object, "create", {
      ...original,
      value: (() => ({
        toJSON() { toJsonCalls++; return "forged-canonical-record"; },
      })) as typeof Object.create,
    });
    observed = {
      before: forwardVaultDigest(before),
      after: forwardVaultDigest(after),
      append: classifyForwardVaultAppend(before, after),
    };
  } finally {
    nativeDefine(Object, "create", original);
  }
  assert.deepEqual(observed, {
    before: expectedBefore, after: expectedAfter, append: "CONFLICT",
  });
  assert.equal(toJsonCalls, 0);
});
