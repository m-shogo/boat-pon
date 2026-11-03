import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvaluationResult,
} from "./forwardEvaluationVault.js";

// Reversible synthetic research metadata only: no private odds, N2, production or scoring authority.
const result = (): EvaluationResult => ({
  schemaVersion: V, kind: "RESULT", recordId: "synthetic:iterator-admission",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
  resultId: "synthetic:iterator-result", analysisSnapshotId: "synthetic:snapshot",
  analysisSnapshotDigest: "a".repeat(64), evaluationProtocolId: "synthetic:protocol",
  evaluationProtocolDigest: "b".repeat(64), decisionSystem: "synthetic:research",
  comparisonMode: "COMMON_COHORT", oddsBasis: "BUY_TIME", metricFamily: "ROI",
  includedCount: 0, excludedCount: 0, metrics: { roi: 0 },
  sourceManifestDigest: "c".repeat(64), evaluatorVersion: "synthetic:v1",
});

function withEmptyArrayIterator<T>(run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  assert.ok(original);
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      ...original, value: function* emptyIterator() {},
    });
    return run();
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, original);
  }
}

test("v0.1 count validation cannot be skipped by an ambient empty array iterator", () => {
  const baseline = result();
  const originalDigest = forwardVaultDigest(baseline);
  const badIncluded = { ...baseline, includedCount: 0.5 };
  const badExcluded = { ...baseline, excludedCount: -1 };
  const badNegativeZero = { ...baseline, includedCount: -0 };
  for (const bad of [badIncluded, badExcluded, badNegativeZero]) {
    assert.equal(validateForwardVaultRecord(bad).valid, false);
  }
  const observed = withEmptyArrayIterator(() => {
    const invalid = [badIncluded, badExcluded, badNegativeZero];
    // Index traversal avoids trusting the iterator under test.
    const verdicts: string[] = [];
    for (let i = 0; i < invalid.length; i++) {
      const bad = invalid[i];
      let digestDenied = false;
      try { forwardVaultDigest(bad); } catch (error) { digestDenied = error instanceof TypeError; }
      const validation = validateForwardVaultRecord(bad);
      verdicts.push(String(!validation.valid && digestDenied && classifyForwardVaultAppend(baseline, bad) === "REJECTED_INVALID"));
    }
    return {
      verdicts: verdicts.join(","),
      baselineDigest: forwardVaultDigest(baseline),
      idempotent: classifyForwardVaultAppend(baseline, { ...baseline }),
      conflict: classifyForwardVaultAppend(baseline, { ...baseline, metrics: { roi: 1 } }),
    };
  });
  assert.deepEqual(observed, {
    verdicts: "true,true,true", baselineDigest: originalDigest,
    idempotent: "IDEMPOTENT_NOOP", conflict: "CONFLICT",
  });
});

test("v0.1 unknown-field diagnostics remain complete under an empty array iterator", () => {
  const bad = { ...result(), extraSyntheticField: "not allowed" };
  const baseline = validateForwardVaultRecord(bad);
  assert.equal(baseline.valid, false);
  assert.ok(baseline.errors.includes("unknown field is not allowed: extraSyntheticField"));
  const observed = withEmptyArrayIterator(() => validateForwardVaultRecord(bad));
  assert.equal(observed.valid, false);
  assert.ok(observed.errors.includes("unknown field is not allowed: extraSyntheticField"));
  assert.deepEqual(observed.errors, baseline.errors);
});

test("v0.1 invalid-kind diagnostics retain prior denials under an empty array iterator", () => {
  const malformed = { ...result(), kind: "SYNTHETIC_UNKNOWN", recordId: " \t", evidenceStage: "UNKNOWN" };
  const baseline = validateForwardVaultRecord(malformed);
  assert.deepEqual(baseline.errors, [
    "recordId must be non-empty", "invalid evidenceStage", "invalid kind",
  ]);
  const observed = withEmptyArrayIterator(() => {
    const verdict = validateForwardVaultRecord(malformed);
    let digestDenied = false;
    try { forwardVaultDigest(malformed as unknown as EvaluationResult); }
    catch (error) { digestDenied = error instanceof TypeError; }
    return { verdict, digestDenied, append: classifyForwardVaultAppend(undefined, malformed) };
  });
  assert.equal(observed.verdict.valid, false);
  assert.deepEqual(observed.verdict.errors, baseline.errors);
  assert.equal(Object.isFrozen(observed.verdict.errors), true);
  assert.equal(observed.digestDenied, true);
  assert.equal(observed.append, "REJECTED_INVALID");
});
