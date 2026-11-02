import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  canPoolStages,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvaluationProtocol,
  type EvidenceStage,
} from "./forwardEvaluationVault.js";

// Synthetic research-only records. This does not establish issuer, settlement,
// readiness, evaluation-protocol approval or production authority.
const protocol = (family: string): EvaluationProtocol => ({
  schemaVersion: V,
  kind: "EVALUATION_PROTOCOL",
  recordId: "synthetic:array-classifier",
  evidenceStage: "SHADOW_FORWARD",
  createdAt: "2026-11-02T00:00:00Z",
  evaluationProtocolId: "synthetic:array-classifier",
  comparisonMode: "COMMON_COHORT",
  oddsBasis: "NONE",
  metricFamilies: [family],
  unresolvedPolicy: "EXCLUDE_AND_COUNT",
  benchmarkDecisionSystems: ["synthetic-shadow"],
  protocolVersion: "synthetic-v1",
});

function withReplacedArrayClassifier<T>(replacement: (value: unknown) => boolean, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Array, "isArray");
  assert.ok(original);
  try {
    Object.defineProperty(Array, "isArray", { ...original, value: replacement });
    return run();
  } finally {
    Object.defineProperty(Array, "isArray", original);
  }
}

test("v0.1 valid protocol and digest remain stable under ambient false Array.isArray", () => {
  const existing = protocol("ROI");
  const changed = protocol("Brier");
  const digest = forwardVaultDigest(existing);
  assert.notEqual(digest, forwardVaultDigest(changed));
  const observed = withReplacedArrayClassifier(() => false, () => ({
    valid: validateForwardVaultRecord(existing).valid,
    digest: forwardVaultDigest(existing),
    append: classifyForwardVaultAppend(existing, { ...existing }),
    conflict: classifyForwardVaultAppend(existing, changed),
  }));
  assert.deepEqual(observed, {
    valid: true, digest, append: "IDEMPOTENT_NOOP", conflict: "CONFLICT",
  });
});

test("v0.1 stage pooling and non-array denial remain stable under ambient classifier replacement", () => {
  const same: EvidenceStage[] = ["SHADOW_FORWARD", "SHADOW_FORWARD"];
  const mixed: EvidenceStage[] = ["SHADOW_FORWARD", "HISTORICAL"];
  const malformed = { ...protocol("ROI"), metricFamilies: { 0: "ROI", length: 1 } };
  const baseline = {
    same: canPoolStages(same),
    mixed: canPoolStages(mixed),
    malformed: validateForwardVaultRecord(malformed).valid,
  };
  assert.deepEqual(baseline, { same: true, mixed: false, malformed: false });
  const alwaysFalse = withReplacedArrayClassifier(() => false, () => ({
    same: canPoolStages(same),
    mixed: canPoolStages(mixed),
    malformed: validateForwardVaultRecord(malformed).valid,
  }));
  const alwaysTrue = withReplacedArrayClassifier(() => true, () => ({
    same: canPoolStages(same),
    mixed: canPoolStages(mixed),
    malformed: validateForwardVaultRecord(malformed).valid,
  }));
  assert.deepEqual(alwaysFalse, baseline);
  assert.deepEqual(alwaysTrue, baseline);
});
