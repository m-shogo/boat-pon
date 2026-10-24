import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvaluationProtocol,
  type EvaluationResult,
} from "./forwardEvaluationVault";

const sha = "a".repeat(64);
function protocol(): EvaluationProtocol {
  return {
    schemaVersion: V, kind: "EVALUATION_PROTOCOL", recordId: "protocol:forEach-test",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-10-21T00:00:00Z",
    evaluationProtocolId: "eval:forEach-test", comparisonMode: "COMMON_COHORT",
    oddsBasis: "BUY_TIME", metricFamilies: ["ROI"],
    unresolvedPolicy: "EXCLUDE_AND_COUNT", benchmarkDecisionSystems: ["fixture"],
    protocolVersion: "fixture-v1",
  };
}
function result(): EvaluationResult {
  return {
    schemaVersion: V, kind: "RESULT", recordId: "result:forEach-test",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-10-21T00:00:00Z",
    resultId: "result:forEach-test", analysisSnapshotId: "snapshot:fixture",
    analysisSnapshotDigest: sha, evaluationProtocolId: "eval:fixture",
    evaluationProtocolDigest: sha, decisionSystem: "fixture", comparisonMode: "COMMON_COHORT",
    oddsBasis: "BUY_TIME", metricFamily: "ROI", includedCount: 1, excludedCount: 0,
    metrics: { roi: 0.5 }, sourceManifestDigest: sha, evaluatorVersion: "fixture-v1",
  };
}

// Synthetic hostile runtime; always restore the ambient method synchronously.
function withNoopForEach<T>(fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "forEach");
  try {
    Object.defineProperty(Array.prototype, "forEach", {
      configurable: true, writable: true, value() { /* synthetic no-op */ },
    });
    return fn();
  } finally {
    if (original) Object.defineProperty(Array.prototype, "forEach", original);
    else Reflect.deleteProperty(Array.prototype, "forEach");
  }
}

test("required nonblank fields reject hostile Array.forEach", () => {
  const good = protocol();
  const bad = { ...good, evaluationProtocolId: "" };
  const observed = withNoopForEach(() => ({
    good: validateForwardVaultRecord(good).valid,
    bad: validateForwardVaultRecord(bad).valid,
    digestThrows: (() => { try { forwardVaultDigest(bad); return false; } catch (e) { return e instanceof TypeError; } })(),
  }));
  assert.deepEqual(observed, { good: true, bad: false, digestThrows: true });
});

test("required digest fields reject hostile Array.forEach", () => {
  const good = result();
  const bad = { ...good, sourceManifestDigest: "not-a-digest" };
  const observed = withNoopForEach(() => ({
    good: validateForwardVaultRecord(good).valid,
    bad: validateForwardVaultRecord(bad).valid,
    digestThrows: (() => { try { forwardVaultDigest(bad); return false; } catch (e) { return e instanceof TypeError; } })(),
  }));
  assert.deepEqual(observed, { good: true, bad: false, digestThrows: true });
});
