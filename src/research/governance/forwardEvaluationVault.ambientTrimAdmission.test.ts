import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  validateForwardVaultRecord,
  type EnrollmentProtocol,
} from "./forwardEvaluationVault.js";

// Synthetic research-only metadata. This does not attest issuer time, settlement
// finality, data-use rights, readiness or production/scoring authority.
const fixture = (): EnrollmentProtocol => ({
  schemaVersion: V,
  kind: "ENROLLMENT_PROTOCOL",
  recordId: "synthetic:trim-boundary",
  evidenceStage: "SHADOW_FORWARD",
  createdAt: "2026-10-14T00:00:00Z",
  enrollmentProtocolId: "synthetic:enrollment",
  decisionSystem: "research-fixture",
  eligibilityRules: ["synthetic-rule"],
  startAt: "2026-10-14T00:00:00Z",
  endAt: null,
  ticketUniverse: ["synthetic-ticket"],
  protocolVersion: "v1",
});

test("v0.1 rejects whitespace-only scalar and array metadata under ambient identity trim", () => {
  const blankId = { ...fixture(), recordId: " \uFEFF\t" };
  const blankRule = { ...fixture(), eligibilityRules: [" \uFEFF\t"] };
  assert.equal(validateForwardVaultRecord(blankId).valid, false);
  assert.equal(validateForwardVaultRecord(blankRule).valid, false);

  const original = String.prototype.trim;
  let idAccepted: boolean | undefined;
  let ruleAccepted: boolean | undefined;
  let appendVerdict: string | undefined;
  try {
    String.prototype.trim = function () { return String(this); };
    idAccepted = validateForwardVaultRecord(blankId).valid;
    ruleAccepted = validateForwardVaultRecord(blankRule).valid;
    appendVerdict = classifyForwardVaultAppend(undefined, blankId);
  } finally {
    String.prototype.trim = original;
  }
  assert.equal(idAccepted, false, "ambient trim must not admit blank record identity");
  assert.equal(ruleAccepted, false, "ambient trim must not admit blank protocol rules");
  assert.equal(appendVerdict, "REJECTED_INVALID");
});

test("v0.1 retains valid metadata under ambient always-empty trim", () => {
  const valid = fixture();
  assert.equal(validateForwardVaultRecord(valid).valid, true);
  const original = String.prototype.trim;
  let accepted: boolean | undefined;
  try {
    String.prototype.trim = function () { return ""; };
    accepted = validateForwardVaultRecord(valid).valid;
  } finally {
    String.prototype.trim = original;
  }
  assert.equal(accepted, true, "ambient trim must not deny valid research metadata");
});
