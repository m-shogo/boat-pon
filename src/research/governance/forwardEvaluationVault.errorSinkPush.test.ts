import assert from "node:assert/strict";
import test from "node:test";
import { FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V, classifyForwardVaultAppend, forwardVaultDigest, validateForwardVaultRecord, type EvaluationProtocol } from "./forwardEvaluationVault";

function protocol(): EvaluationProtocol {
  return { schemaVersion: V, kind: "EVALUATION_PROTOCOL", recordId: "protocol:push-fixture",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-10-21T00:00:00Z",
    evaluationProtocolId: "eval:push-fixture", comparisonMode: "COMMON_COHORT",
    oddsBasis: "BUY_TIME", metricFamilies: ["ROI"], unresolvedPolicy: "EXCLUDE_AND_COUNT",
    benchmarkDecisionSystems: ["fixture"], protocolVersion: "fixture-v1" };
}
function withNoopPush<T>(fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "push");
  try {
    Object.defineProperty(Array.prototype, "push", { configurable: true, writable: true, value() { return this.length; } });
    return fn();
  } finally {
    if (original) Object.defineProperty(Array.prototype, "push", original);
    else Reflect.deleteProperty(Array.prototype, "push");
  }
}
test("Forward Vault rejects invalid records when Array.push is a no-op", () => {
  const good = protocol(), bad = { ...good, evaluationProtocolId: "" };
  const observed = withNoopPush(() => ({
    good: validateForwardVaultRecord(good).valid,
    bad: validateForwardVaultRecord(bad).valid,
    digestRejected: (() => { try { forwardVaultDigest(bad); return false; } catch (e) { return e instanceof TypeError; } })(),
  }));
  assert.deepEqual(observed, { good: true, bad: false, digestRejected: true });
});

test("Forward Vault denial sink ignores an inherited index-zero setter", () => {
  const good = protocol();
  const bad = { ...good, evaluationProtocolId: "" };
  assert.equal(validateForwardVaultRecord(good).valid, true);
  assert.equal(validateForwardVaultRecord(bad).valid, false);

  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let intercepted = 0;
  let observed: {
    good: boolean; bad: boolean; errors: string[];
    digestRejected: boolean; append: string;
  } | undefined;
  try {
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      get() { return "inherited"; },
      set(_value: unknown) { intercepted++; },
    });
    const verdict = validateForwardVaultRecord(bad);
    observed = {
      good: validateForwardVaultRecord(good).valid,
      bad: verdict.valid,
      errors: verdict.errors,
      digestRejected: (() => {
        try { forwardVaultDigest(bad); return false; }
        catch (error) { return error instanceof TypeError; }
      })(),
      append: classifyForwardVaultAppend(undefined, bad),
    };
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "0", previous);
    else Reflect.deleteProperty(Array.prototype, "0");
  }
  assert.equal(intercepted, 0);
  assert.deepEqual(observed, {
    good: true, bad: false,
    errors: ["evaluationProtocolId must be non-empty"],
    digestRejected: true, append: "REJECTED_INVALID",
  });
});
