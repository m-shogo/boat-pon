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

// Reversible synthetic caller-realm mutation; no private data, N2 or production.
const sha = "a".repeat(64);
const membership = (): Membership => ({
  schemaVersion: V, kind: "MEMBERSHIP", recordId: "synthetic:string-index",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
  cohortId: "synthetic:cohort", enrollmentProtocolId: "synthetic:enrollment",
  enrollmentProtocolDigest: sha, canonicalRaceId: "synthetic:race",
  decisionRecordId: "synthetic:decision", decisionRecordDigest: sha,
  enrolledAt: "2026-11-02T00:00:00Z", included: true, reason: "synthetic",
});
const protocol = (families: string[]): EvaluationProtocol => ({
  schemaVersion: V, kind: "EVALUATION_PROTOCOL", recordId: "synthetic:string-index-protocol",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
  evaluationProtocolId: "synthetic:protocol", comparisonMode: "COMMON_COHORT",
  oddsBasis: "NONE", metricFamilies: families, unresolvedPolicy: "EXCLUDE_AND_COUNT",
  benchmarkDecisionSystems: ["synthetic-shadow"], protocolVersion: "synthetic-v1",
});

function withReplacedNumericString<T>(run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "String");
  assert.ok(original);
  const nativeString = String;
  try {
    Object.defineProperty(globalThis, "String", {
      ...original,
      value: (value: unknown) => typeof value === "number" ? "0" : nativeString(value),
    });
    return run();
  } finally {
    Object.defineProperty(globalThis, "String", original);
  }
}

test("v0.1 stage pooling rejects mixed stages under ambient numeric String coercion", () => {
  const mixed: EvidenceStage[] = ["SHADOW_FORWARD", "HISTORICAL"];
  const baseline = canPoolStages(mixed);
  const observed = withReplacedNumericString(() => canPoolStages(mixed));
  assert.equal(baseline, false);
  assert.equal(observed, false);
});

test("v0.1 protocol array admission and digest remain stable under ambient numeric String coercion", () => {
  const original = protocol(["ROI", "Brier"]);
  const changed = protocol(["ROI", "LogLoss"]);
  const digest = forwardVaultDigest(original);
  const observed = withReplacedNumericString(() => ({
    valid: validateForwardVaultRecord(original).valid,
    digest: forwardVaultDigest(original),
    conflict: classifyForwardVaultAppend(original, changed),
  }));
  assert.deepEqual(observed, { valid: true, digest, conflict: "CONFLICT" });
});

test("v0.1 multiple validation denials retain distinct indexed errors under ambient String coercion", () => {
  const malformed = { ...membership(), recordId: "", evidenceStage: "UNTRUSTED", createdAt: "invalid" };
  const baseline = validateForwardVaultRecord(malformed);
  const observed = withReplacedNumericString(() => validateForwardVaultRecord(malformed));
  assert.equal(baseline.valid, false);
  assert.ok(baseline.errors.length >= 3);
  assert.deepEqual(observed, baseline);
});
