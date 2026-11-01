import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  validateForwardVaultRecord,
  type EnrollmentProtocol,
} from "./forwardEvaluationVault.js";

// Synthetic claimed clocks only. This test never authenticates issuer time,
// finality, K-data rights, scoring eligibility or production behavior.
const enrollment = (startAt: string, endAt: string | null): EnrollmentProtocol => ({
  schemaVersion: V,
  kind: "ENROLLMENT_PROTOCOL",
  recordId: "synthetic:ambient-clock",
  evidenceStage: "SHADOW_FORWARD",
  createdAt: "2026-10-14T00:00:00Z",
  enrollmentProtocolId: "synthetic:ambient-enrollment",
  decisionSystem: "research-fixture",
  eligibilityRules: ["synthetic-rule"],
  startAt,
  endAt,
  ticketUniverse: ["synthetic-ticket"],
  protocolVersion: "v1",
});

test("v0.1 chronology rejects reversed boundaries after ambient Date.parse mutation", () => {
  const reversed = enrollment("2026-10-15T00:00:00.000000001Z", "2026-10-14T23:59:59.999999999Z");
  assert.equal(validateForwardVaultRecord(reversed).valid, false);
  const original = Date.parse;
  let accepted: boolean | undefined;
  try {
    Date.parse = () => 0;
    accepted = validateForwardVaultRecord(reversed).valid;
  } finally {
    Date.parse = original;
  }
  assert.equal(accepted, false, "ambient Date.parse must not relabel chronology");
});

test("v0.1 syntax accepts valid bounded timestamps after ambient RegExp.exec mutation", () => {
  const valid = enrollment("2026-10-14T00:00:00.123456789Z", "2026-10-15T00:00:00+09:00");
  assert.equal(validateForwardVaultRecord(valid).valid, true);
  const original = RegExp.prototype.exec;
  let accepted: boolean | undefined;
  try {
    RegExp.prototype.exec = () => null;
    accepted = validateForwardVaultRecord(valid).valid;
  } finally {
    RegExp.prototype.exec = original;
  }
  assert.equal(accepted, true, "ambient RegExp.exec must not deny a valid clock");
});
