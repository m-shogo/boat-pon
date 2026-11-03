import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type Membership,
} from "./forwardEvaluationVault";

const digest = (letter: string) => letter.repeat(64);

function membership(reason: string): Membership {
  return {
    schemaVersion: V,
    kind: "MEMBERSHIP",
    recordId: "member:synthetic-map-boundary",
    evidenceStage: "SHADOW_FORWARD",
    createdAt: "2026-10-24T00:00:00Z",
    cohortId: "cohort:synthetic",
    enrollmentProtocolId: "enrollment:synthetic",
    enrollmentProtocolDigest: digest("a"),
    canonicalRaceId: "race:synthetic",
    decisionRecordId: "decision:synthetic",
    decisionRecordDigest: digest("b"),
    enrolledAt: "2026-10-24T00:00:00Z",
    included: true,
    reason,
  };
}

test("canonical digests remain distinct under a no-op Array.prototype.map", () => {
  const existing = membership("prospectively included");
  const changed = membership("changed after enrollment");
  const baselineExisting = forwardVaultDigest(existing);
  const baselineChanged = forwardVaultDigest(changed);
  assert.notEqual(baselineExisting, baselineChanged);
  assert.equal(validateForwardVaultRecord(existing).valid, true);
  assert.equal(validateForwardVaultRecord(changed).valid, true);

  const original = Object.getOwnPropertyDescriptor(Array.prototype, "map");
  assert.ok(original);
  let observedExisting: string | undefined;
  let observedChanged: string | undefined;
  let observedClassification: string | undefined;
  try {
    Object.defineProperty(Array.prototype, "map", { ...original, value: () => [] });
    observedExisting = forwardVaultDigest(existing);
    observedChanged = forwardVaultDigest(changed);
    observedClassification = classifyForwardVaultAppend(existing, changed);
  } finally {
    Object.defineProperty(Array.prototype, "map", original);
  }

  assert.equal(observedExisting, baselineExisting);
  assert.equal(observedChanged, baselineChanged);
  assert.notEqual(observedExisting, observedChanged);
  assert.equal(observedClassification, "CONFLICT");
});

test("normal map behavior preserves canonical idempotency", () => {
  const existing = membership("prospectively included");
  const identical = { ...existing };
  assert.equal(classifyForwardVaultAppend(existing, identical), "IDEMPOTENT_NOOP");
  assert.equal(forwardVaultDigest(existing), forwardVaultDigest(identical));
});
