import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvaluationProtocol,
} from "./forwardEvaluationVault.js";

// Synthetic records only; never actual odds, outcomes, or scoring authority.
function protocol(metricFamily: string): EvaluationProtocol {
  return {
    schemaVersion: V, kind: "EVALUATION_PROTOCOL",
    recordId: "protocol:synthetic-array-tojson",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-10-24T00:00:00Z",
    evaluationProtocolId: "eval:synthetic-array-tojson",
    comparisonMode: "COMMON_COHORT", oddsBasis: "BUY_TIME",
    metricFamilies: [metricFamily], unresolvedPolicy: "EXCLUDE_AND_COUNT",
    benchmarkDecisionSystems: ["synthetic-shadow"], protocolVersion: "synthetic-v1",
  };
}

test("inherited Array.prototype.toJSON cannot alias changed append-only protocols", () => {
  const existing = protocol("ROI");
  const changed = protocol("LOGLOSS");
  const expectedExisting = forwardVaultDigest(existing);
  const expectedChanged = forwardVaultDigest(changed);
  assert.notEqual(expectedExisting, expectedChanged);
  assert.equal(classifyForwardVaultAppend(existing, changed), "CONFLICT");

  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  try {
    Object.defineProperty(Array.prototype, "toJSON", {
      configurable: true, value() { return ["synthetic-erased"]; },
    });
    // This is precisely why the validator must reject arrays with a toJSON hook.
    assert.equal(JSON.stringify(existing), JSON.stringify(changed));
    assert.equal(validateForwardVaultRecord(existing).valid, false);
    assert.equal(validateForwardVaultRecord(changed).valid, false);
    assert.equal(classifyForwardVaultAppend(existing, changed), "REJECTED_INVALID");
    assert.throws(() => forwardVaultDigest(existing), TypeError);
    assert.throws(() => forwardVaultDigest(changed), TypeError);
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "toJSON", previous);
    else Reflect.deleteProperty(Array.prototype, "toJSON");
  }

  assert.equal(forwardVaultDigest(existing), expectedExisting);
  assert.equal(forwardVaultDigest(changed), expectedChanged);
  assert.equal(classifyForwardVaultAppend(existing, changed), "CONFLICT");
});

test("a toJSON hook on an individual protocol array also fails closed", () => {
  const candidate = protocol("ROI");
  Object.defineProperty(candidate.metricFamilies, "toJSON", {
    configurable: true, value() { return ["synthetic-erased"]; },
  });
  assert.equal(validateForwardVaultRecord(candidate).valid, false);
  assert.equal(classifyForwardVaultAppend(undefined, candidate), "REJECTED_INVALID");
  assert.throws(() => forwardVaultDigest(candidate), TypeError);
});

test("ordinary valid array contents preserve deterministic digest identity", () => {
  const first = protocol("ROI");
  const equivalent = { ...first, metricFamilies: ["ROI"], benchmarkDecisionSystems: ["synthetic-shadow"] };
  assert.equal(validateForwardVaultRecord(first).valid, true);
  assert.equal(forwardVaultDigest(first), forwardVaultDigest(equivalent));
  assert.equal(classifyForwardVaultAppend(first, equivalent), "IDEMPOTENT_NOOP");
});
