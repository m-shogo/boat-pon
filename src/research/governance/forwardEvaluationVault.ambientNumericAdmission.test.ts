import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvaluationResult,
} from "./forwardEvaluationVault.js";

// Reversible synthetic research metadata only: no private odds, production or N2.
const result = (): EvaluationResult => ({
  schemaVersion: V, kind: "RESULT", recordId: "synthetic:numeric",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
  resultId: "synthetic:result", analysisSnapshotId: "synthetic:snapshot",
  analysisSnapshotDigest: "a".repeat(64), evaluationProtocolId: "synthetic:protocol",
  evaluationProtocolDigest: "b".repeat(64), decisionSystem: "synthetic:research",
  comparisonMode: "COMMON_COHORT", oddsBasis: "BUY_TIME", metricFamily: "ROI",
  includedCount: 0, excludedCount: 0, metrics: { roi: 0 },
  sourceManifestDigest: "c".repeat(64), evaluatorVersion: "synthetic:v1",
});

function observeUnderOverride(
  owner: object, key: string, replacement: (...args: unknown[]) => unknown,
  baseline: EvaluationResult, malformed: EvaluationResult,
): { valid: boolean; append: string; digestDenied: boolean; baselineDigest: string } {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  assert.ok(descriptor);
  let observed: { valid: boolean; append: string; digestDenied: boolean; baselineDigest: string } | undefined;
  try {
    Object.defineProperty(owner, key, { ...descriptor, value: replacement });
    let digestDenied = false;
    try { forwardVaultDigest(malformed); } catch (error) { digestDenied = error instanceof TypeError; }
    observed = {
      valid: validateForwardVaultRecord(malformed).valid,
      append: classifyForwardVaultAppend(baseline, malformed),
      digestDenied,
      baselineDigest: forwardVaultDigest(baseline),
    };
  } finally {
    Object.defineProperty(owner, key, descriptor);
  }
  assert.ok(observed);
  return observed;
}

test("v0.1 rejects NaN metric under replaced Number.isFinite", () => {
  const baseline = result();
  const originalDigest = forwardVaultDigest(baseline);
  const malformed = { ...baseline, metrics: { roi: Number.NaN } };
  assert.equal(validateForwardVaultRecord(malformed).valid, false);
  assert.deepEqual(
    observeUnderOverride(Number, "isFinite", () => true, baseline, malformed),
    { valid: false, append: "REJECTED_INVALID", digestDenied: true, baselineDigest: originalDigest },
  );
});

test("v0.1 rejects fractional count under replaced Number.isSafeInteger", () => {
  const baseline = result();
  const originalDigest = forwardVaultDigest(baseline);
  const malformed = { ...baseline, includedCount: 0.5 };
  assert.equal(validateForwardVaultRecord(malformed).valid, false);
  assert.deepEqual(
    observeUnderOverride(Number, "isSafeInteger", () => true, baseline, malformed),
    { valid: false, append: "REJECTED_INVALID", digestDenied: true, baselineDigest: originalDigest },
  );
});

test("v0.1 rejects negative-zero metric and count under replaced Object.is", () => {
  const baseline = result();
  const originalDigest = forwardVaultDigest(baseline);
  for (const malformed of [
    { ...baseline, includedCount: -0 },
    { ...baseline, metrics: { roi: -0 } },
  ]) {
    assert.equal(validateForwardVaultRecord(malformed).valid, false);
    assert.deepEqual(
      observeUnderOverride(Object, "is", () => false, baseline, malformed),
      { valid: false, append: "REJECTED_INVALID", digestDenied: true, baselineDigest: originalDigest },
    );
  }
});
