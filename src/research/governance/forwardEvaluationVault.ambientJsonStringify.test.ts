import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type Membership,
} from "./forwardEvaluationVault.js";

// Synthetic research metadata only: no private odds, settlement or production input.
const sha = "a".repeat(64);
function membership(reason: string): Membership {
  return {
    schemaVersion: V, kind: "MEMBERSHIP", recordId: "synthetic:serializer",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
    cohortId: "synthetic:cohort", enrollmentProtocolId: "synthetic:enroll",
    enrollmentProtocolDigest: sha, canonicalRaceId: "synthetic:race",
    decisionRecordId: "synthetic:decision", decisionRecordDigest: sha,
    enrolledAt: "2026-11-02T00:00:00Z", included: true, reason,
  };
}
function withAmbientSerializer<T>(replacement: (...args: unknown[]) => string, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(JSON, "stringify");
  assert.ok(descriptor);
  try {
    Object.defineProperty(JSON, "stringify", { ...descriptor, value: replacement });
    return fn();
  } finally {
    Object.defineProperty(JSON, "stringify", descriptor);
  }
}

test("v0.1 canonical SHA and append decision resist constant ambient JSON.stringify", () => {
  const existing = membership("synthetic:before");
  const changed = membership("synthetic:after");
  const before = forwardVaultDigest(existing);
  const after = forwardVaultDigest(changed);
  assert.notEqual(before, after);
  const observed = withAmbientSerializer(() => "{}", () => ({
    before: forwardVaultDigest(existing),
    after: forwardVaultDigest(changed),
    append: classifyForwardVaultAppend(existing, changed),
    valid: validateForwardVaultRecord(changed).valid,
  }));
  assert.deepEqual(observed, {
    before, after, append: "CONFLICT", valid: true,
  });
});

test("v0.1 canonical SHA remains stable if ambient JSON.stringify throws", () => {
  const record = membership("synthetic:unchanged");
  const expected = forwardVaultDigest(record);
  const observed = withAmbientSerializer(() => {
    throw new Error("synthetic ambient serializer trap");
  }, () => ({
    digest: forwardVaultDigest(record),
    append: classifyForwardVaultAppend(record, { ...record }),
  }));
  assert.deepEqual(observed, { digest: expected, append: "IDEMPOTENT_NOOP" });
});
