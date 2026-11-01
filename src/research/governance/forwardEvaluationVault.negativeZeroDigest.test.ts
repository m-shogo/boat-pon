import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvaluationResult,
} from "./forwardEvaluationVault.js";

// Synthetic research metadata only; no odds, outcomes, private files or production inputs.
const sha = (c: string): string => c.repeat(64);
const result = (): EvaluationResult => ({
  schemaVersion: V, kind: "RESULT", recordId: "synthetic:negative-zero",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-01T00:00:00Z",
  resultId: "synthetic:result", analysisSnapshotId: "synthetic:snapshot",
  analysisSnapshotDigest: sha("a"), evaluationProtocolId: "synthetic:protocol",
  evaluationProtocolDigest: sha("b"), decisionSystem: "research-fixture",
  comparisonMode: "COMMON_COHORT", oddsBasis: "BUY_TIME", metricFamily: "ROI",
  includedCount: 0, excludedCount: 0, metrics: { roi: 0 },
  sourceManifestDigest: sha("c"), evaluatorVersion: "synthetic-v1",
});

function assertDeniedAlias(baseline: EvaluationResult, malformed: EvaluationResult): void {
  assert.notStrictEqual(Object.is(malformed.includedCount, -0)
    || Object.is(malformed.excludedCount, -0)
    || Object.is(malformed.metrics.roi, -0), false);
  assert.equal(JSON.stringify(malformed), JSON.stringify(baseline),
    "JSON serialization aliases -0 to 0, even though Object.is distinguishes them");
  assert.equal(validateForwardVaultRecord(malformed).valid, false);
  assert.equal(classifyForwardVaultAppend(undefined, malformed), "REJECTED_INVALID");
  assert.equal(classifyForwardVaultAppend(baseline, malformed), "REJECTED_INVALID");
  assert.throws(() => forwardVaultDigest(malformed), TypeError);
}

test("v0.1 result counters reject negative-zero JSON digest aliases", () => {
  const baseline = result();
  assert.equal(validateForwardVaultRecord(baseline).valid, true);
  assertDeniedAlias(baseline, { ...baseline, includedCount: -0 });
  assertDeniedAlias(baseline, { ...baseline, excludedCount: -0 });
});

test("v0.1 result metric values reject negative-zero JSON digest aliases", () => {
  const baseline = result();
  assertDeniedAlias(baseline, { ...baseline, metrics: { roi: -0 } });
});

test("v0.1 ordinary zero and finite negative metrics remain digest-stable", () => {
  const baseline = result();
  assert.equal(validateForwardVaultRecord(baseline).valid, true);
  assert.equal(classifyForwardVaultAppend(baseline, { ...baseline }), "IDEMPOTENT_NOOP");
  assert.equal(forwardVaultDigest(baseline), forwardVaultDigest({ ...baseline, metrics: { roi: 0 } }));
  const negativeMetric = { ...baseline, metrics: { roi: -0.125 } };
  assert.equal(validateForwardVaultRecord(negativeMetric).valid, true);
  assert.notEqual(forwardVaultDigest(negativeMetric), forwardVaultDigest(baseline));
});
