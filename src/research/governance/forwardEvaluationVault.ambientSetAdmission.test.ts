import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  canPoolStages,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvidenceStage,
  type EvaluationProtocol,
  type Membership,
} from "./forwardEvaluationVault.js";

// Synthetic research metadata only; no real odds, outcomes or production input.
const sha = "a".repeat(64);
function membership(): Membership {
  return {
    schemaVersion: V, kind: "MEMBERSHIP", recordId: "synthetic:set-stage",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
    cohortId: "synthetic:cohort", enrollmentProtocolId: "synthetic:enroll",
    enrollmentProtocolDigest: sha, canonicalRaceId: "synthetic:race",
    decisionRecordId: "synthetic:decision", decisionRecordDigest: sha,
    enrolledAt: "2026-11-02T00:00:00Z", included: true, reason: "synthetic",
  };
}
function protocol(metricFamilies: string[]): EvaluationProtocol {
  return {
    schemaVersion: V, kind: "EVALUATION_PROTOCOL", recordId: "synthetic:set-unique",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
    evaluationProtocolId: "synthetic:protocol", comparisonMode: "COMMON_COHORT",
    oddsBasis: "NONE", metricFamilies, unresolvedPolicy: "EXCLUDE_AND_COUNT",
    benchmarkDecisionSystems: ["synthetic-shadow"], protocolVersion: "synthetic-v1",
  };
}
function withSetMethodReplacement<T>(
  method: "has" | "add", replacement: (...args: unknown[]) => unknown, run: () => T,
): T {
  const original = Object.getOwnPropertyDescriptor(Set.prototype, method);
  assert.ok(original);
  try {
    Object.defineProperty(Set.prototype, method, { ...original, value: replacement });
    return run();
  } finally {
    Object.defineProperty(Set.prototype, method, original);
  }
}

for (const [method, replacement, scenario] of [
  ["has", function () { return true; }, "always-true membership"],
  ["has", function () { return false; }, "always-false membership"],
  ["add", function (this: unknown) { return this; }, "no-op insertion"],
] as const) {
  test(`v0.1 stage and duplicate admission resist ambient Set.${method} (${scenario})`, () => {
    const valid = membership();
    const unknown = { ...valid, evidenceStage: "UNTRUSTED" };
    const unique = protocol(["ROI", "Brier"]);
    const changed = protocol(["ROI", "LogLoss"]);
    const duplicate = protocol(["ROI", "ROI"]);
    const baseline = {
      validStage: validateForwardVaultRecord(valid).valid,
      unknownStage: validateForwardVaultRecord(unknown).valid,
      validPool: canPoolStages(["SHADOW_FORWARD"]),
      unknownPool: canPoolStages(["UNTRUSTED" as EvidenceStage]),
      unique: validateForwardVaultRecord(unique).valid,
      duplicate: validateForwardVaultRecord(duplicate).valid,
      digest: forwardVaultDigest(unique),
      conflict: classifyForwardVaultAppend(unique, changed),
      duplicateAppend: classifyForwardVaultAppend(undefined, duplicate),
    };
    assert.deepEqual(baseline, {
      validStage: true, unknownStage: false, validPool: true, unknownPool: false,
      unique: true, duplicate: false, digest: baseline.digest,
      conflict: "CONFLICT", duplicateAppend: "REJECTED_INVALID",
    });
    const observed = withSetMethodReplacement(method, replacement, () => ({
      validStage: validateForwardVaultRecord(valid).valid,
      unknownStage: validateForwardVaultRecord(unknown).valid,
      validPool: canPoolStages(["SHADOW_FORWARD"]),
      unknownPool: canPoolStages(["UNTRUSTED" as EvidenceStage]),
      unique: validateForwardVaultRecord(unique).valid,
      duplicate: validateForwardVaultRecord(duplicate).valid,
      digest: forwardVaultDigest(unique),
      conflict: classifyForwardVaultAppend(unique, changed),
      duplicateAppend: classifyForwardVaultAppend(undefined, duplicate),
    }));
    assert.deepEqual(observed, baseline);
  });
}
