import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EvaluationResult,
} from "./forwardEvaluationVault.js";

const sha = "a".repeat(64);
function result(metrics: Record<string, number> = { roi: 0.5 }): EvaluationResult {
  return {
    schemaVersion: V, kind: "RESULT", recordId: "result:prototype", evidenceStage: "SHADOW_FORWARD",
    createdAt: "2026-10-08T00:00:00Z", resultId: "result:prototype", analysisSnapshotId: "snapshot:1",
    analysisSnapshotDigest: sha, evaluationProtocolId: "eval:1", evaluationProtocolDigest: sha,
    decisionSystem: "research-fixture", comparisonMode: "COMMON_COHORT", oddsBasis: "BUY_TIME",
    metricFamily: "ROI", includedCount: 1, excludedCount: 0, metrics,
    sourceManifestDigest: sha, evaluatorVersion: "fixture-v1",
  };
}

test("non-JSON metric objects cannot hide a different persisted payload", () => {
  const dateMetrics = new Date("2026-10-08T00:00:00Z") as Date & { roi: number };
  dateMetrics.roi = 0.5;
  const candidate = result(dateMetrics as unknown as Record<string, number>);
  const plain = result();
  assert.notDeepEqual(JSON.parse(JSON.stringify(candidate)), JSON.parse(JSON.stringify(plain)));
  assert.equal(validateForwardVaultRecord(candidate).valid, false);
  assert.equal(classifyForwardVaultAppend(plain, candidate), "REJECTED_INVALID");
  assert.throws(() => forwardVaultDigest(candidate), TypeError);
});

test("inherited toJSON cannot change the persisted top-level record", () => {
  const candidate = Object.assign(Object.create({ toJSON: () => ({}) }), result()) as EvaluationResult;
  assert.deepEqual(JSON.parse(JSON.stringify(candidate)), {});
  assert.equal(validateForwardVaultRecord(candidate).valid, false);
  assert.equal(classifyForwardVaultAppend(result(), candidate), "REJECTED_INVALID");
  assert.throws(() => forwardVaultDigest(candidate), TypeError);
});

test("inherited metric toJSON cannot change the persisted metrics object", () => {
  const metrics = Object.assign(Object.create({ toJSON: () => ({}) }), { roi: 0.5 });
  const candidate = result(metrics);
  assert.deepEqual(JSON.parse(JSON.stringify(candidate)).metrics, {});
  assert.equal(validateForwardVaultRecord(candidate).valid, false);
  assert.equal(classifyForwardVaultAppend(result(), candidate), "REJECTED_INVALID");
  assert.throws(() => forwardVaultDigest(candidate), TypeError);
});

test("own non-enumerable toJSON cannot bypass canonical hashing", () => {
  const metrics = { roi: 0.5 };
  Object.defineProperty(metrics, "toJSON", { value: () => ({ roi: 9 }), enumerable: false });
  const candidate = result(metrics);
  assert.equal(validateForwardVaultRecord(candidate).valid, false);
  assert.equal(classifyForwardVaultAppend(result(), candidate), "REJECTED_INVALID");
  assert.throws(() => forwardVaultDigest(candidate), TypeError);
});

test("plain and null-prototype JSON metrics retain valid idempotency", () => {
  const plain = result();
  const metrics = Object.assign(Object.create(null), { roi: 0.5 }) as Record<string, number>;
  const candidate = result(metrics);
  assert.equal(validateForwardVaultRecord(plain).valid, true);
  assert.equal(validateForwardVaultRecord(candidate).valid, true);
  assert.equal(forwardVaultDigest(candidate), forwardVaultDigest(plain));
  assert.equal(classifyForwardVaultAppend(plain, candidate), "IDEMPOTENT_NOOP");
});
