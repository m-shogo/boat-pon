import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EnrollmentProtocol,
} from "./forwardEvaluationVault";

/**
 * Synthetic v0.1 resource-bound regression. A well-formed clock claim does
 * not authenticate a source, prove settlement finality or authorize scoring.
 */
const prefix = "2026-10-14T12:00:00.";
const at = (digits: number, suffix = "Z"): string => prefix + "1".repeat(digits) + suffix;
const fixture = (createdAt: string): EnrollmentProtocol => ({
  schemaVersion: V,
  kind: "ENROLLMENT_PROTOCOL",
  recordId: "synthetic:v01-fraction-bound",
  evidenceStage: "SHADOW_FORWARD",
  createdAt,
  enrollmentProtocolId: "synthetic:enrollment",
  decisionSystem: "research-fixture",
  eligibilityRules: ["synthetic-rule"],
  startAt: "2026-10-14T00:00:00Z",
  endAt: null,
  ticketUniverse: ["synthetic-ticket"],
  protocolVersion: "v1",
});

test("Forward Vault v0.1 admits 64 digits and rejects 65 or oversized clock claims", () => {
  for (const suffix of ["Z", "+23:59"]) {
    const accepted = fixture(at(64, suffix));
    const rejected = fixture(at(65, suffix));
    assert.equal(validateForwardVaultRecord(accepted).valid, true, suffix);
    assert.equal(validateForwardVaultRecord(rejected).valid, false, suffix);
    assert.equal(classifyForwardVaultAppend(undefined, rejected), "REJECTED_INVALID", suffix);
    assert.throws(() => forwardVaultDigest(rejected), /invalid Forward Evaluation Vault record/u);
  }
  assert.equal(validateForwardVaultRecord(fixture(at(100_000))).valid, false);
  assert.equal(validateForwardVaultRecord(fixture(at(18))).valid, true);
});

test("Forward Vault v0.1 schema and runtime enforce the same fraction/length bound", () => {
  const schema = JSON.parse(readFileSync(
    new URL("../../../config/research-governance/forward-evaluation-vault.schema.json", import.meta.url),
    "utf8",
  )) as { $defs: { exactInstant: { pattern: string; maxLength: number } } };
  const exact = schema.$defs.exactInstant;
  assert.equal(exact.maxLength, 90);
  const pattern = new RegExp(exact.pattern, "u");
  for (const suffix of ["Z", "+23:59"]) {
    for (const [digits, expected] of [[64, true], [65, false]] as const) {
      const value = at(digits, suffix);
      assert.equal(pattern.test(value) && value.length <= exact.maxLength, expected);
      assert.equal(validateForwardVaultRecord(fixture(value)).valid, expected);
    }
  }
});

test("all v0.1 enrollment timestamp slots use bounded validation", () => {
  const base = fixture("2026-10-14T00:00:00Z");
  for (const field of ["createdAt", "startAt", "endAt"] as const) {
    assert.equal(validateForwardVaultRecord({ ...base, [field]: at(64) }).valid, true, field);
    assert.equal(validateForwardVaultRecord({ ...base, [field]: at(65) }).valid, false, field);
  }
});
