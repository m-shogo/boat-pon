import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  canPoolStages, classifyForwardVaultAppend, forwardVaultDigest,
  validateForwardVaultRecord, type EvaluationProtocol, type EvidenceStage,
} from "./forwardEvaluationVault.js";

// Synthetic metadata only; no K evidence, N2, private odds or production inputs.
const nativeObject = Object;
const protocol = (family: string): EvaluationProtocol => ({
  schemaVersion: V, kind: "EVALUATION_PROTOCOL",
  recordId: "synthetic:prototype", evidenceStage: "SHADOW_FORWARD",
  createdAt: "2026-11-02T00:00:00Z",
  evaluationProtocolId: "synthetic:prototype",
  comparisonMode: "COMMON_COHORT", oddsBasis: "NONE",
  metricFamilies: [family], unresolvedPolicy: "EXCLUDE_AND_COUNT",
  benchmarkDecisionSystems: ["synthetic-shadow"], protocolVersion: "v1",
});

function withReplacedGlobal<T>(key: "Object" | "Array", replacement: unknown, run: () => T): T {
  const original = nativeObject.getOwnPropertyDescriptor(globalThis, key);
  assert.ok(original);
  try {
    nativeObject.defineProperty(globalThis, key, { ...original, value: replacement });
    return run();
  } finally {
    nativeObject.defineProperty(globalThis, key, original);
  }
}

test("v0.1 valid plain record admission and digest survive global Object replacement", () => {
  const valid = protocol("ROI"), changed = protocol("Brier");
  const exotic = nativeObject.assign(nativeObject.create({ untrusted: true }), protocol("ROI"));
  const assessment = () => ({
    valid: validateForwardVaultRecord(valid).valid,
    digest: forwardVaultDigest(valid),
    append: classifyForwardVaultAppend(undefined, valid),
    idempotent: classifyForwardVaultAppend(valid, { ...valid }),
    conflict: classifyForwardVaultAppend(valid, changed),
    exoticDenied: !validateForwardVaultRecord(exotic).valid,
  });
  const baseline = assessment();
  const observed = withReplacedGlobal("Object", function ForeignObject() {}, assessment);
  assert.deepEqual(observed, baseline);
  assert.deepEqual(
    { valid: baseline.valid, append: baseline.append, idempotent: baseline.idempotent,
      conflict: baseline.conflict, exoticDenied: baseline.exoticDenied },
    { valid: true, append: "APPEND", idempotent: "IDEMPOTENT_NOOP",
      conflict: "CONFLICT", exoticDenied: true },
  );
});

test("v0.1 dense arrays and stage pooling survive global Array replacement", () => {
  const valid = protocol("ROI");
  const malformed = { ...valid, metricFamilies: { 0: "ROI", length: 1 } };
  const same: EvidenceStage[] = ["SHADOW_FORWARD", "SHADOW_FORWARD"];
  const mixed: EvidenceStage[] = ["SHADOW_FORWARD", "HISTORICAL"];
  const assessment = () => ({
    valid: validateForwardVaultRecord(valid).valid,
    malformedDenied: !validateForwardVaultRecord(malformed).valid,
    digest: forwardVaultDigest(valid),
    sameStage: canPoolStages(same),
    mixedStage: canPoolStages(mixed),
  });
  const baseline = assessment();
  const observed = withReplacedGlobal("Array", function ForeignArray() {}, assessment);
  assert.deepEqual(observed, baseline);
  assert.equal(baseline.valid, true);
  assert.equal(baseline.malformedDenied, true);
  assert.equal(baseline.sameStage, true);
  assert.equal(baseline.mixedStage, false);
});
