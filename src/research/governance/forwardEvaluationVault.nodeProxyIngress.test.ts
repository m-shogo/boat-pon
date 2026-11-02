import assert from "node:assert/strict";
import test from "node:test";
import { types as nodeTypes } from "node:util";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  canPoolStages,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvidenceStage,
  type EvaluationProtocol,
  type EvaluationResult,
} from "./forwardEvaluationVault.js";

// Synthetic research-only metadata. No private K inputs, odds, N2 or production.
const result = (): EvaluationResult => ({
  schemaVersion: V, kind: "RESULT", recordId: "synthetic:proxy-result",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
  resultId: "synthetic:result", analysisSnapshotId: "synthetic:snapshot",
  analysisSnapshotDigest: "a".repeat(64), evaluationProtocolId: "synthetic:protocol",
  evaluationProtocolDigest: "b".repeat(64), decisionSystem: "synthetic:research",
  comparisonMode: "COMMON_COHORT", oddsBasis: "BUY_TIME", metricFamily: "ROI",
  includedCount: 1, excludedCount: 0, metrics: { roi: 1 },
  sourceManifestDigest: "c".repeat(64), evaluatorVersion: "synthetic:v1",
});
const protocol = (): EvaluationProtocol => ({
  schemaVersion: V, kind: "EVALUATION_PROTOCOL", recordId: "synthetic:proxy-protocol",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-01T00:00:00Z",
  evaluationProtocolId: "synthetic:protocol", comparisonMode: "COMMON_COHORT",
  oddsBasis: "BUY_TIME", metricFamilies: ["ROI"],
  unresolvedPolicy: "EXCLUDE_AND_COUNT",
  benchmarkDecisionSystems: ["synthetic:research"], protocolVersion: "synthetic:v1",
});

test("v0.1 rejects Proxy get/descriptor disagreement before invoking any traps", () => {
  const baseline = result();
  const digest = forwardVaultDigest(baseline);
  let trapCount = 0;
  const malformed = { ...baseline, includedCount: -1 };
  const proxy = new Proxy(malformed, {
    get(target, key, receiver) {
      trapCount++;
      return key === "includedCount" ? 1 : Reflect.get(target, key, receiver);
    },
    getPrototypeOf(target) { trapCount++; return Reflect.getPrototypeOf(target); },
    ownKeys(target) { trapCount++; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      trapCount++; return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.equal(nodeTypes.isProxy(proxy), true);
  assert.equal(Object.getOwnPropertyDescriptor(malformed, "includedCount")?.value, -1);
  assert.equal(validateForwardVaultRecord(proxy).valid, false);
  assert.equal(classifyForwardVaultAppend(undefined, proxy), "REJECTED_INVALID");
  assert.throws(() => forwardVaultDigest(proxy), TypeError);
  assert.equal(trapCount, 0);
  assert.equal(forwardVaultDigest(baseline), digest);
  assert.equal(classifyForwardVaultAppend(baseline, { ...baseline }), "IDEMPOTENT_NOOP");
  assert.equal(classifyForwardVaultAppend(baseline, { ...baseline, metrics: { roi: 2 } }), "CONFLICT");
});

test("v0.1 revoked root and nested Proxy objects fail closed", () => {
  const revokedRoot = Proxy.revocable(result(), {});
  revokedRoot.revoke();
  assert.equal(validateForwardVaultRecord(revokedRoot.proxy).valid, false);
  assert.equal(classifyForwardVaultAppend(undefined, revokedRoot.proxy), "REJECTED_INVALID");
  assert.throws(() => forwardVaultDigest(revokedRoot.proxy), TypeError);

  const revokedMetrics = Proxy.revocable({ roi: 1 }, {});
  revokedMetrics.revoke();
  const badMetrics = { ...result(), metrics: revokedMetrics.proxy };
  assert.equal(validateForwardVaultRecord(badMetrics).valid, false);
  assert.equal(classifyForwardVaultAppend(undefined, badMetrics), "REJECTED_INVALID");
  assert.throws(() => forwardVaultDigest(badMetrics), TypeError);

  const revokedFamilies = Proxy.revocable(["ROI"], {});
  revokedFamilies.revoke();
  assert.equal(validateForwardVaultRecord({ ...protocol(), metricFamilies: revokedFamilies.proxy }).valid, false);
});

test("v0.1 nested array, metric and stage-pooling Proxy traps never execute", () => {
  let traps = 0;
  const trap = {
    get(target: object, key: PropertyKey, receiver: unknown) {
      traps++;
      return Reflect.get(target, key, receiver);
    },
    getPrototypeOf(target: object) { traps++; return Reflect.getPrototypeOf(target); },
    ownKeys(target: object) { traps++; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target: object, key: PropertyKey) {
      traps++; return Reflect.getOwnPropertyDescriptor(target, key);
    },
  };
  const nestedMetrics = { ...result(), metrics: new Proxy({ roi: 1 }, trap) };
  const nestedProtocol = { ...protocol(), metricFamilies: new Proxy(["ROI"], trap) };
  const stages: EvidenceStage[] = new Proxy(["SHADOW_FORWARD", "SHADOW_FORWARD"] as EvidenceStage[], trap);
  assert.equal(validateForwardVaultRecord(nestedMetrics).valid, false);
  assert.equal(validateForwardVaultRecord(nestedProtocol).valid, false);
  assert.equal(classifyForwardVaultAppend(undefined, nestedMetrics), "REJECTED_INVALID");
  assert.throws(() => forwardVaultDigest(nestedMetrics), TypeError);
  assert.equal(canPoolStages(stages), false);
  assert.equal(traps, 0);

  assert.equal(validateForwardVaultRecord(protocol()).valid, true);
  assert.equal(validateForwardVaultRecord(result()).valid, true);
  assert.equal(canPoolStages(["SHADOW_FORWARD", "SHADOW_FORWARD"]), true);
  assert.equal(canPoolStages(["HISTORICAL", "SHADOW_FORWARD"]), false);
});
