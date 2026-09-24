import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteJson, verifyJsonReadback } from "./executorSdk.js";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  type EnrollmentProtocol,
} from "./forwardEvaluationVault.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function protocol(recordId = "vault-protocol-1"): EnrollmentProtocol {
  return {
    schemaVersion: FORWARD_EVALUATION_VAULT_SCHEMA_VERSION,
    kind: "ENROLLMENT_PROTOCOL",
    recordId,
    evidenceStage: "SHADOW_FORWARD",
    createdAt: "2026-09-24T12:00:00Z",
    enrollmentProtocolId: "enroll-1",
    decisionSystem: "research-only",
    eligibilityRules: ["decision exists before enrollment"],
    startAt: "2026-09-24T12:00:00Z",
    endAt: null,
    ticketUniverse: ["fixture-ticket"],
    protocolVersion: "v1",
  };
}

describe("Forward Evaluation Vault persistence boundary", () => {
  it("atomically publishes once and verifies read-back without replacement", () => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-"));
    roots.push(root);
    const path = join(root, "vault-protocol-1.json");
    const value = protocol();

    atomicWriteJson(path, value);
    expect(verifyJsonReadback(path).ok).toBe(true);

    const persisted = JSON.parse(readFileSync(path, "utf8")) as EnrollmentProtocol;
    expect(classifyForwardVaultAppend(persisted, value)).toBe("IDEMPOTENT_NOOP");
    expect(forwardVaultDigest(persisted)).toBe(forwardVaultDigest(value));
    expect(() => atomicWriteJson(path, value)).toThrow(/target already exists/u);
  });

  it("fails closed when the same record identity has different content", () => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-"));
    roots.push(root);
    const path = join(root, "vault-protocol-1.json");
    const original = protocol();
    atomicWriteJson(path, original);

    const persisted = JSON.parse(readFileSync(path, "utf8")) as EnrollmentProtocol;
    const changed: EnrollmentProtocol = { ...original, protocolVersion: "v2" };
    expect(classifyForwardVaultAppend(persisted, changed)).toBe("CONFLICT");
    expect(() => atomicWriteJson(path, changed)).toThrow(/target already exists/u);

    const after = JSON.parse(readFileSync(path, "utf8")) as EnrollmentProtocol;
    expect(forwardVaultDigest(after)).toBe(forwardVaultDigest(original));
    expect(after.protocolVersion).toBe("v1");
  });
});
