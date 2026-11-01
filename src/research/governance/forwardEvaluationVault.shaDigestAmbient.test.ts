import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type AnalysisSnapshot,
  type Membership,
} from "./forwardEvaluationVault.js";

// Synthetic metadata only: no K issuer, private odds, settlement, or production input.
const sha = "a".repeat(64);
const membership = (): Membership => ({
  schemaVersion: V, kind: "MEMBERSHIP", recordId: "synthetic:sha-member",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-01T00:00:00Z",
  cohortId: "synthetic:cohort", enrollmentProtocolId: "synthetic:enroll",
  enrollmentProtocolDigest: sha, canonicalRaceId: "synthetic:race",
  decisionRecordId: "synthetic:decision", decisionRecordDigest: sha,
  enrolledAt: "2026-11-01T00:00:00Z", included: true, reason: "synthetic",
});
const snapshot = (): AnalysisSnapshot => ({
  schemaVersion: V, kind: "ANALYSIS_SNAPSHOT", recordId: "synthetic:sha-snapshot",
  evidenceStage: "SHADOW_FORWARD", createdAt: "2026-11-01T00:00:00Z",
  analysisSnapshotId: "synthetic:snapshot", cohortId: "synthetic:cohort",
  cutoffAt: "2026-11-01T00:00:00Z", membershipDigests: [sha],
});

function underAmbientRegexHooks<T>(testHook: RegExp["test"], execHook: RegExp["exec"], check: () => T): T {
  const originalTest = RegExp.prototype.test;
  const originalExec = RegExp.prototype.exec;
  try {
    RegExp.prototype.test = testHook;
    RegExp.prototype.exec = execHook;
    return check();
  } finally {
    RegExp.prototype.test = originalTest;
    RegExp.prototype.exec = originalExec;
  }
}

test("v0.1 scalar SHA fields fail closed when ambient RegExp.test and exec forge matches", () => {
  const valid = membership();
  const malformed = { ...valid, decisionRecordDigest: "not-a-sha" };
  assert.equal(validateForwardVaultRecord(valid).valid, true);
  assert.equal(validateForwardVaultRecord(malformed).valid, false);
  const observed = underAmbientRegexHooks(
    () => true,
    () => ["synthetic-forged-match"] as RegExpExecArray,
    () => ({
      valid: validateForwardVaultRecord(valid).valid,
      malformed: validateForwardVaultRecord(malformed).valid,
      append: classifyForwardVaultAppend(undefined, malformed),
      digestRejected: (() => { try { forwardVaultDigest(malformed as Membership); return false; } catch { return true; } })(),
    }),
  );
  assert.deepEqual(observed, {
    valid: true, malformed: false, append: "REJECTED_INVALID", digestRejected: true,
  });
});

test("v0.1 digest arrays retain valid entries and reject malformed entries under denying regex hooks", () => {
  const valid = snapshot();
  const malformed = { ...valid, membershipDigests: ["invalid-digest"] };
  assert.equal(validateForwardVaultRecord(valid).valid, true);
  assert.equal(validateForwardVaultRecord(malformed).valid, false);
  const observed = underAmbientRegexHooks(
    () => false,
    () => null,
    () => ({
      valid: validateForwardVaultRecord(valid).valid,
      malformed: validateForwardVaultRecord(malformed).valid,
      append: classifyForwardVaultAppend(undefined, malformed),
      digestRejected: (() => { try { forwardVaultDigest(malformed as AnalysisSnapshot); return false; } catch { return true; } })(),
    }),
  );
  assert.deepEqual(observed, {
    valid: true, malformed: false, append: "REJECTED_INVALID", digestRejected: true,
  });
});
