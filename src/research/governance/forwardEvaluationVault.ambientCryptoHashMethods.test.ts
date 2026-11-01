import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    schemaVersion: V, kind: "MEMBERSHIP", recordId: "synthetic:hash-method",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
    cohortId: "synthetic:cohort", enrollmentProtocolId: "synthetic:enroll",
    enrollmentProtocolDigest: sha, canonicalRaceId: "synthetic:race",
    decisionRecordId: "synthetic:decision", decisionRecordDigest: sha,
    enrolledAt: "2026-11-02T00:00:00Z", included: true, reason,
  };
}
function withHashMethodReplacement<T>(
  method: "update" | "digest",
  replacement: (...args: unknown[]) => unknown,
  run: () => T,
): T {
  const prototype = Object.getPrototypeOf(createHash("sha256")) as object;
  const original = Object.getOwnPropertyDescriptor(prototype, method);
  assert.ok(original);
  try {
    Object.defineProperty(prototype, method, { ...original, value: replacement });
    return run();
  } finally {
    Object.defineProperty(prototype, method, original);
  }
}

for (const method of ["update", "digest"] as const) {
  test(`v0.1 SHA-256 cannot alias changed membership through ambient Hash.${method}`, () => {
    const existing = membership("synthetic:before");
    const changed = membership("synthetic:after");
    const before = forwardVaultDigest(existing);
    const after = forwardVaultDigest(changed);
    assert.notEqual(before, after);
    assert.equal(classifyForwardVaultAppend(existing, changed), "CONFLICT");

    const replacement = method === "update"
      ? function (this: unknown) { return this; }
      : function () { return "0".repeat(64); };
    const observed = withHashMethodReplacement(method, replacement, () => ({
      before: forwardVaultDigest(existing),
      after: forwardVaultDigest(changed),
      append: classifyForwardVaultAppend(existing, changed),
      valid: validateForwardVaultRecord(changed).valid,
    }));
    assert.deepEqual(observed, {
      before, after, append: "CONFLICT", valid: true,
    });
  });
}
