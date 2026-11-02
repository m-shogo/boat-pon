import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  type Membership,
} from "./forwardEvaluationVault.js";

// Synthetic research metadata only: no K evidence, odds, protected N2 or production.
const member = (): Membership => ({
  schemaVersion: V, kind: "MEMBERSHIP", recordId: "synthetic:falsy-existing",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-02T00:00:00Z",
  cohortId: "synthetic:cohort", enrollmentProtocolId: "synthetic:enrollment",
  enrollmentProtocolDigest: "a".repeat(64), canonicalRaceId: "synthetic:race",
  decisionRecordId: "synthetic:decision", decisionRecordDigest: "b".repeat(64),
  enrolledAt: "2026-11-02T00:00:00Z", included: true,
  reason: "synthetic:enrolled",
});

test("v0.1 rejects falsy malformed existing records instead of treating them as absent", () => {
  const candidate = member();
  const originalDigest = forwardVaultDigest(candidate);
  for (const existing of [null, false, 0, ""]) {
    assert.equal(
      classifyForwardVaultAppend(existing as unknown as Membership, candidate),
      "REJECTED_INVALID",
      `malformed existing value: ${String(existing)}`,
    );
  }
  assert.equal(forwardVaultDigest(candidate), originalDigest);
});

test("v0.1 preserves explicit absence, idempotency and immutable conflict behavior", () => {
  const candidate = member();
  assert.equal(classifyForwardVaultAppend(undefined, candidate), "APPEND");
  assert.equal(classifyForwardVaultAppend(candidate, { ...candidate }), "IDEMPOTENT_NOOP");
  assert.equal(
    classifyForwardVaultAppend(candidate, { ...candidate, reason: "synthetic:changed" }),
    "CONFLICT",
  );
  assert.equal(classifyForwardVaultAppend(candidate, { ...candidate, recordId: "other" }), "CONFLICT");
});
