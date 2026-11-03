import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvaluationResult,
  type Membership,
} from "./forwardEvaluationVault.js";

// Synthetic metadata only; never read private odds, settlement or production data.
const sha = "a".repeat(64);
const base = {
  schemaVersion: V,
  evidenceStage: "SHADOW_FORWARD" as const,
  createdAt: "2026-11-02T00:00:00Z",
};
function membership(reason: string): Membership {
  return {
    ...base, kind: "MEMBERSHIP", recordId: "synthetic:member",
    cohortId: "synthetic:cohort", enrollmentProtocolId: "synthetic:enrollment",
    enrollmentProtocolDigest: sha, canonicalRaceId: "synthetic:race",
    decisionRecordId: "synthetic:decision", decisionRecordDigest: sha,
    enrolledAt: base.createdAt, included: true, reason,
  };
}
function result(metrics: Record<string, number>): EvaluationResult {
  return {
    ...base, kind: "RESULT", recordId: "synthetic:result",
    resultId: "synthetic:result", analysisSnapshotId: "synthetic:snapshot",
    analysisSnapshotDigest: sha, evaluationProtocolId: "synthetic:protocol",
    evaluationProtocolDigest: sha, decisionSystem: "synthetic-research",
    comparisonMode: "COMMON_COHORT", oddsBasis: "NONE", metricFamily: "ROI",
    includedCount: 1, excludedCount: 0, metrics,
    sourceManifestDigest: sha, evaluatorVersion: "synthetic-v1",
  };
}

test("v0.1 canonical digest cannot erase record fields through ambient Object.keys", () => {
  const existing = membership("synthetic:before");
  const changed = membership("synthetic:after");
  const originalDigest = forwardVaultDigest(existing);
  const changedDigest = forwardVaultDigest(changed);
  assert.notEqual(originalDigest, changedDigest);
  assert.equal(classifyForwardVaultAppend(existing, changed), "CONFLICT");

  const original = Object.getOwnPropertyDescriptor(Object, "keys");
  assert.ok(original);
  const nativeKeys = Object.keys;
  let observed: { before: string; after: string; append: string } | undefined;
  try {
    Object.defineProperty(Object, "keys", {
      ...original,
      value(target: object): string[] {
        if (target === existing || target === changed) return [];
        return nativeKeys(target);
      },
    });
    observed = {
      before: forwardVaultDigest(existing),
      after: forwardVaultDigest(changed),
      append: classifyForwardVaultAppend(existing, changed),
    };
  } finally {
    Object.defineProperty(Object, "keys", original);
  }
  assert.deepEqual(observed, {
    before: originalDigest, after: changedDigest, append: "CONFLICT",
  });
});

test("v0.1 metric admission cannot hide nonfinite fields through ambient Object.keys", () => {
  const baseline = result({ roi: 0.25 });
  const hiddenNonfinite = { roi: 0.25, hidden: Number.NaN };
  const malformed = result(hiddenNonfinite);
  assert.equal(validateForwardVaultRecord(baseline).valid, true);
  assert.equal(validateForwardVaultRecord(malformed).valid, false);

  const original = Object.getOwnPropertyDescriptor(Object, "keys");
  assert.ok(original);
  const nativeKeys = Object.keys;
  let observed: { valid: boolean; append: string; digestDenied: boolean } | undefined;
  try {
    Object.defineProperty(Object, "keys", {
      ...original,
      value(target: object): string[] {
        if (target === hiddenNonfinite) return ["roi"];
        return nativeKeys(target);
      },
    });
    let digestDenied = false;
    try { forwardVaultDigest(malformed); }
    catch (error) { digestDenied = error instanceof TypeError; }
    observed = {
      valid: validateForwardVaultRecord(malformed).valid,
      append: classifyForwardVaultAppend(baseline, malformed),
      digestDenied,
    };
  } finally {
    Object.defineProperty(Object, "keys", original);
  }
  assert.deepEqual(observed, {
    valid: false, append: "REJECTED_INVALID", digestDenied: true,
  });
});
