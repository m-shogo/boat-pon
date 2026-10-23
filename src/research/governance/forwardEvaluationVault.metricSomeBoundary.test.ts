import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvaluationResult,
} from "./forwardEvaluationVault.js";

// Synthetic research-only record; no real odds, outcome, or scoring authority.
function result(): EvaluationResult {
  return {
    schemaVersion: V, kind: "RESULT", recordId: "synthetic-metric-some-result",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-10-23T12:00:00Z",
    resultId: "synthetic-result", analysisSnapshotId: "synthetic-snapshot",
    analysisSnapshotDigest: "a".repeat(64),
    evaluationProtocolId: "synthetic-protocol",
    evaluationProtocolDigest: "b".repeat(64),
    decisionSystem: "synthetic-shadow", comparisonMode: "COMMON_COHORT",
    oddsBasis: "BUY_TIME", metricFamily: "ROI", includedCount: 1,
    excludedCount: 0, metrics: { roi: 0.25 },
    sourceManifestDigest: "c".repeat(64), evaluatorVersion: "synthetic-v1",
  };
}

test("metric values and symbol shape reject no-op Array.prototype.some", () => {
  const good = result();
  const symbolMetrics = { roi: 0.25 };
  Object.defineProperty(symbolMetrics, Symbol("synthetic-hidden-metric"), {
    enumerable: true, value: 1,
  });
  const invalid = [
    { ...good, metrics: symbolMetrics },
    { ...good, metrics: { roi: Number.NaN } },
    { ...good, metrics: { roi: Number.POSITIVE_INFINITY } },
    { ...good, metrics: { roi: Number.NEGATIVE_INFINITY } },
    { ...good, metrics: { roi: "0.25" } },
  ];
  assert.equal(validateForwardVaultRecord(good).valid, true);
  for (const candidate of invalid) {
    assert.equal(validateForwardVaultRecord(candidate).valid, false);
  }

  const original = Object.getOwnPropertyDescriptor(Array.prototype, "some");
  const observed: { valid: boolean; digestRejected: boolean; appendDecision: string }[] = [];
  let validUnderOverride = false;
  try {
    Object.defineProperty(Array.prototype, "some", {
      configurable: true, writable: true, value() { return false; },
    });
    validUnderOverride = validateForwardVaultRecord(good).valid;
    for (let index = 0; index < invalid.length; index++) {
      const candidate = invalid[index];
      let digestRejected = false;
      try { forwardVaultDigest(candidate as EvaluationResult); }
      catch (error) { digestRejected = error instanceof TypeError; }
      observed[index] = {
        valid: validateForwardVaultRecord(candidate).valid,
        digestRejected,
        appendDecision: classifyForwardVaultAppend(undefined, candidate),
      };
    }
  } finally {
    if (original) Object.defineProperty(Array.prototype, "some", original);
    else Reflect.deleteProperty(Array.prototype, "some");
  }
  assert.equal(validUnderOverride, true);
  for (const item of observed) {
    assert.deepEqual(item, {
      valid: false, digestRejected: true, appendDecision: "REJECTED_INVALID",
    });
  }
});

test("valid finite metrics remain digest-stable and idempotent", () => {
  const a = result(), b = { ...a, metrics: { roi: 0.25 } };
  assert.equal(validateForwardVaultRecord(a).valid, true);
  assert.equal(forwardVaultDigest(a), forwardVaultDigest(b));
  assert.equal(classifyForwardVaultAppend(a, b), "IDEMPOTENT_NOOP");
});
