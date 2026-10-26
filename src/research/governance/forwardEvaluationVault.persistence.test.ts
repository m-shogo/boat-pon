import assert from "node:assert/strict";
import { linkSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
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
    assert.equal(verifyJsonReadback(path).ok, true);

    const persisted = JSON.parse(readFileSync(path, "utf8")) as EnrollmentProtocol;
    assert.equal(classifyForwardVaultAppend(persisted, value), "IDEMPOTENT_NOOP");
    assert.equal(forwardVaultDigest(persisted), forwardVaultDigest(value));
    assert.throws(() => atomicWriteJson(path, value), /target already exists/u);
  });

  it("fails closed when the same record identity has different content", () => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-"));
    roots.push(root);
    const path = join(root, "vault-protocol-1.json");
    const original = protocol();
    atomicWriteJson(path, original);

    const persisted = JSON.parse(readFileSync(path, "utf8")) as EnrollmentProtocol;
    const changed: EnrollmentProtocol = { ...original, protocolVersion: "v2" };
    assert.equal(classifyForwardVaultAppend(persisted, changed), "CONFLICT");
    assert.throws(() => atomicWriteJson(path, changed), /target already exists/u);

    const after = JSON.parse(readFileSync(path, "utf8")) as EnrollmentProtocol;
    assert.equal(forwardVaultDigest(after), forwardVaultDigest(original));
    assert.equal(after.protocolVersion, "v1");
  });
  it("fails closed on an interrupted no-replace publication without discarding the published bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-"));
    roots.push(root);
    const path = join(root, "vault-protocol-1.json");
    const temp = `${path}.tmp-simulated-interruption`;
    const value = protocol();

    // Model the exact on-disk state after executorSdk.atomicWriteUtf8
    // linkSync(temp, path), but before its finally-block unlinkSync(temp).
    // This is a synthetic interruption fixture, not a real process crash.
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\\n`, "utf8");
    linkSync(temp, path);

    assert.equal(statSync(path).nlink, 2);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), value);
    const interruptedReadback = verifyJsonReadback(path);
    assert.equal(interruptedReadback.ok, false);
    assert.match(interruptedReadback.errors.join(" "), /single-link regular file/u);
    assert.throws(() => atomicWriteJson(path, value), /target already exists/u);
    assert.equal(
      classifyForwardVaultAppend(JSON.parse(readFileSync(path, "utf8")) as EnrollmentProtocol, value),
      "IDEMPOTENT_NOOP",
    );

    // Removing only the known synthetic temporary hard link restores the
    // existing single-link readback invariant without replacing the record.
    unlinkSync(temp);
    assert.equal(statSync(path).nlink, 1);
    assert.equal(verifyJsonReadback(path).ok, true);
    assert.equal(forwardVaultDigest(JSON.parse(readFileSync(path, "utf8"))), forwardVaultDigest(value));
  });

});
