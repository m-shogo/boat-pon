import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  canPoolStages,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvaluationProtocol,
} from "./forwardEvaluationVault.js";

// Synthetic metadata only. No K source, odds, N2, scoring or production inputs.
const nativeSet = Set;
const protocol = (metricFamilies: string[]): EvaluationProtocol => ({
  schemaVersion: V, kind: "EVALUATION_PROTOCOL",
  recordId: "synthetic:constructor", evidenceStage: "SHADOW_FORWARD",
  createdAt: "2026-11-02T00:00:00Z",
  evaluationProtocolId: "synthetic:constructor",
  comparisonMode: "COMMON_COHORT", oddsBasis: "NONE",
  metricFamilies, unresolvedPolicy: "EXCLUDE_AND_COUNT",
  benchmarkDecisionSystems: ["synthetic-shadow"], protocolVersion: "v1",
});

function withReplacedGlobalSet<T>(replacement: unknown, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Set");
  assert.ok(original);
  try {
    Object.defineProperty(globalThis, "Set", { ...original, value: replacement });
    return run();
  } finally {
    Object.defineProperty(globalThis, "Set", original);
  }
}

function assessment() {
  const valid = protocol(["ROI", "Brier"]);
  const duplicate = protocol(["ROI", "ROI"]);
  const changed = protocol(["ROI", "LogLoss"]);
  return {
    valid: validateForwardVaultRecord(valid).valid,
    duplicate: validateForwardVaultRecord(duplicate).valid,
    digest: forwardVaultDigest(valid),
    append: classifyForwardVaultAppend(undefined, valid),
    idempotent: classifyForwardVaultAppend(valid, { ...valid }),
    conflict: classifyForwardVaultAppend(valid, changed),
    sameStage: canPoolStages(["SHADOW_FORWARD", "SHADOW_FORWARD"]),
    mixedStage: canPoolStages(["SHADOW_FORWARD", "HISTORICAL"]),
  };
}

test("v0.1 unique-array admission resists a throwing ambient Set constructor", () => {
  const baseline = assessment();
  class ThrowingSet { constructor() { throw new Error("ambient Set replaced"); } }
  const observed = withReplacedGlobalSet(ThrowingSet, assessment);
  assert.deepEqual(observed, baseline);
  assert.equal(baseline.valid, true);
  assert.equal(baseline.duplicate, false);
});

test("v0.1 unique-array admission resists a pre-seeded ambient Set constructor", () => {
  const baseline = assessment();
  class SeededSet extends nativeSet {
    constructor() { super(["ROI"]); }
  }
  const observed = withReplacedGlobalSet(SeededSet, assessment);
  assert.deepEqual(observed, baseline);
  assert.equal(baseline.append, "APPEND");
  assert.equal(baseline.idempotent, "IDEMPOTENT_NOOP");
  assert.equal(baseline.conflict, "CONFLICT");
});
