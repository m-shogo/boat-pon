import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type Membership,
} from "./forwardEvaluationVault.js";

// Reversible synthetic metadata only. No private evidence, production or N2.
const sha = "a".repeat(64);
const member = (): Membership => ({
  schemaVersion: V, kind: "MEMBERSHIP", recordId: "synthetic:own-kind",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
  cohortId: "synthetic:cohort", enrollmentProtocolId: "synthetic:enrollment",
  enrollmentProtocolDigest: sha, canonicalRaceId: "synthetic:race",
  decisionRecordId: "synthetic:decision", decisionRecordDigest: sha,
  enrolledAt: "2026-11-02T00:00:00Z", included: true, reason: "synthetic:enrolled",
});

test("v0.1 valid fixed-schema membership survives caller-replaced hasOwnProperty", () => {
  const baseline = member();
  const digest = forwardVaultDigest(baseline);
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "hasOwnProperty");
  assert.ok(descriptor);
  let observed: { valid: boolean; append: string; digest: string } | undefined;
  try {
    Object.defineProperty(Object.prototype, "hasOwnProperty", { ...descriptor, value: () => false });
    observed = {
      valid: validateForwardVaultRecord(baseline).valid,
      append: classifyForwardVaultAppend(undefined, baseline),
      digest: forwardVaultDigest(baseline),
    };
  } finally {
    Object.defineProperty(Object.prototype, "hasOwnProperty", descriptor);
  }
  assert.deepEqual(observed, { valid: true, append: "APPEND", digest });
});

test("v0.1 inherited kind names remain invalid when hasOwnProperty is replaced", () => {
  const malformed = { ...member(), kind: "__proto__" };
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "hasOwnProperty");
  assert.ok(descriptor);
  let observed: { valid: boolean; append: string; digestDenied: boolean } | undefined;
  try {
    Object.defineProperty(Object.prototype, "hasOwnProperty", { ...descriptor, value: () => true });
    let digestDenied = false;
    try { forwardVaultDigest(malformed as unknown as Membership); }
    catch (error) { digestDenied = error instanceof TypeError; }
    observed = {
      valid: validateForwardVaultRecord(malformed).valid,
      append: classifyForwardVaultAppend(undefined, malformed),
      digestDenied,
    };
  } finally {
    Object.defineProperty(Object.prototype, "hasOwnProperty", descriptor);
  }
  assert.deepEqual(observed, { valid: false, append: "REJECTED_INVALID", digestDenied: true });
});

test("v0.1 unknown-field diagnostics do not trust caller-replaced Array.includes", () => {
  const baseline = member();
  const digest = forwardVaultDigest(baseline);
  const malformed = { ...baseline, syntheticExtra: "not-allowed" };
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "includes");
  assert.ok(descriptor);
  let observed: { valid: boolean; errors: string[]; append: string; digestDenied: boolean; baselineDigest: string } | undefined;
  try {
    Object.defineProperty(Array.prototype, "includes", { ...descriptor, value: () => true });
    let digestDenied = false;
    try { forwardVaultDigest(malformed as unknown as Membership); }
    catch (error) { digestDenied = error instanceof TypeError; }
    const verdict = validateForwardVaultRecord(malformed);
    observed = {
      valid: verdict.valid, errors: verdict.errors,
      append: classifyForwardVaultAppend(undefined, malformed),
      digestDenied, baselineDigest: forwardVaultDigest(baseline),
    };
  } finally {
    Object.defineProperty(Array.prototype, "includes", descriptor);
  }
  assert.ok(observed);
  assert.equal(observed.valid, false);
  assert.equal(observed.errors.some((error) => error === "unknown field is not allowed: syntheticExtra"), true);
  assert.equal(observed.append, "REJECTED_INVALID");
  assert.equal(observed.digestDenied, true);
  assert.equal(observed.baselineDigest, digest);
});
