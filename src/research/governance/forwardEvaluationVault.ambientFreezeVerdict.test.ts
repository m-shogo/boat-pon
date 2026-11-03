import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  validateForwardVaultRecord,
  type Membership,
} from "./forwardEvaluationVault.js";

// Synthetic metadata only. Never read private K evidence, odds or production data.
const sha = "a".repeat(64);
const membership = (): Membership => ({
  schemaVersion: V, kind: "MEMBERSHIP", recordId: "synthetic:freeze-member",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
  cohortId: "synthetic:cohort", enrollmentProtocolId: "synthetic:enroll",
  enrollmentProtocolDigest: sha, canonicalRaceId: "synthetic:race",
  decisionRecordId: "synthetic:decision", decisionRecordDigest: sha,
  enrolledAt: "2026-11-02T00:00:00Z", included: true, reason: "synthetic",
});

function underNoopFreeze<T>(run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
  assert.ok(descriptor);
  const nativeDefine = Object.defineProperty;
  try {
    nativeDefine(Object, "freeze", {
      ...descriptor, value: ((value: object) => value) as typeof Object.freeze,
    });
    return run();
  } finally {
    nativeDefine(Object, "freeze", descriptor);
  }
}

test("v0.1 invalid verdict and error list stay frozen under ambient no-op Object.freeze", () => {
  const malformed = { ...membership(), included: "not-boolean" };
  const verdict = underNoopFreeze(() => validateForwardVaultRecord(malformed));
  assert.equal(verdict.valid, false);
  assert.deepEqual(verdict.errors, ["included must be boolean"]);
  assert.equal(Object.isFrozen(verdict), true);
  assert.equal(Object.isFrozen(verdict.errors), true);
  assert.throws(() => { verdict.valid = true; }, TypeError);
  assert.throws(() => { verdict.errors.push("forged"); }, TypeError);
});

test("v0.1 valid verdict and empty diagnostics stay frozen under ambient no-op Object.freeze", () => {
  const verdict = underNoopFreeze(() => validateForwardVaultRecord(membership()));
  assert.equal(verdict.valid, true);
  assert.deepEqual(verdict.errors, []);
  assert.equal(Object.isFrozen(verdict), true);
  assert.equal(Object.isFrozen(verdict.errors), true);
  assert.throws(() => { verdict.valid = false; }, TypeError);
  assert.throws(() => { verdict.errors.push("forged"); }, TypeError);
});
