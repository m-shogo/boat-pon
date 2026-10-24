import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { buildForwardV02IndependentProofRequest } from "./forwardV02IndependentProofRequest";
import { digestForwardV02UntrustedRequest } from "./forwardV02UntrustedVerifierResponse";
import { assessForwardV02SyntheticEd25519Claim } from "./forwardV02SyntheticEd25519Claim";

const h = (c: string) => c.repeat(64);

function fixture() {
  const envelope = {
    schemaVersion: "forward-v02-authority-metadata.0.1-untrusted",
    evidenceStage: "SHADOW_FORWARD",
    freeze: {
      cohortId: "synthetic-cohort", protocolDigest: h("a"), membershipDigest: h("b"),
      firstDecisionAt: "2026-10-24T00:00:00.0002Z",
      expectedMembership: ["synthetic-decision"], includedMembership: ["synthetic-decision"],
      excludedMembership: [],
      witness: {
        receiptId: "synthetic-receipt", issuerId: "synthetic-witness-issuer",
        receiptAt: "2026-10-24T00:00:00.0001Z",
        protocolDigest: h("a"), membershipDigest: h("b"),
        signatureDigest: h("c"), trustAnchorId: "synthetic-witness-anchor",
      },
    },
    settlement: {
      expectedDecisionId: "synthetic-decision", decisionId: "synthetic-decision",
      expectedTicketKey: "synthetic-ticket", ticketKey: "synthetic-ticket",
      sourceId: "synthetic-settlement-source", trustAnchorId: "synthetic-settlement-anchor",
      disposition: "SETTLED", evaluable: true,
      revisions: [{
        revisionId: "synthetic-revision", contentDigest: h("d"),
        predecessorDigest: null as string | null, sequence: 1,
        observedAt: "2026-10-24T00:00:01Z", sourceFinality: "FINAL",
      }],
    },
  };
  const policy = {
    schemaVersion: "forward-v02-trust-policy.0.1-untrusted",
    snapshotDigest: h("e"), reviewState: "REVIEWED",
    anchors: [
      {
        anchorId: "synthetic-witness-anchor", authorityId: "synthetic-witness-issuer",
        role: "WITNESS", algorithm: "Ed25519", publicKeyDigest: h("f"),
        state: "ACTIVE", validFrom: "2026-10-23T00:00:00Z",
        validUntil: "2026-10-25T00:00:00Z",
      },
      {
        anchorId: "synthetic-settlement-anchor", authorityId: "synthetic-settlement-source",
        role: "SETTLEMENT", algorithm: "Ed25519", publicKeyDigest: h("a"),
        state: "ACTIVE", validFrom: "2026-10-23T00:00:00Z",
        validUntil: "2026-10-25T00:00:00Z",
      },
    ],
  };
  const refs = {
    schemaVersion: "forward-v02-proof-refs.0.1-untrusted",
    policySnapshotDigest: h("e"), witnessReceiptId: "synthetic-receipt",
    witnessProofDigest: h("b"), settlementRevisionId: "synthetic-revision",
    settlementProofDigest: h("c"),
  };
  // Ephemeral synthetic keys exist only in this test process, never in Git.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const built = buildForwardV02IndependentProofRequest(envelope, policy, refs);
  assert.ok(built.request);
  const digest = digestForwardV02UntrustedRequest(built.request);
  const claim = {
    schemaVersion: "forward-v02-synthetic-ed25519-claim.0.1-untrusted",
    claimedSignerId: "synthetic-signer",
    claimedPublicKeySpkiPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    claimedRequestBindingDigest: digest,
    claimedSignatureHex: sign(null, Buffer.from(digest, "hex"), privateKey).toString("hex"),
  };
  return { envelope, policy, refs, claim, privateKey };
}
const check = (f: ReturnType<typeof fixture>) =>
  assessForwardV02SyntheticEd25519Claim(f.envelope, f.policy, f.refs, f.claim);

test("matching synthetic Ed25519 signature proves math only, never external authority", () => {
  const result = check(fixture());
  assert.equal(result.requestMetadataConsistent, true);
  assert.equal(result.signatureMathConsistent, true);
  assert.equal(result.independentAuthorityVerified, false);
  assert.equal(result.scoringAuthorized, false);
  assert.deepEqual(result.blockers, ["CALLER_SUPPLIED_KEY_NOT_AUTHORITY"]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.blockers), true);
});

test("wrong public key and changed signature fail closed without authority", () => {
  const wrong = fixture();
  const { publicKey } = generateKeyPairSync("ed25519");
  wrong.claim.claimedPublicKeySpkiPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  assert.deepEqual(check(wrong).blockers, ["SIGNATURE_MISMATCH"]);
  const modified = fixture();
  modified.claim.claimedSignatureHex = "0".repeat(128);
  assert.deepEqual(check(modified).blockers, ["SIGNATURE_MISMATCH"]);
  assert.equal(check(modified).scoringAuthorized, false);
});

test("a changed request cannot borrow the previous valid signature", () => {
  const f = fixture();
  f.envelope.freeze.protocolDigest = h("f");
  f.envelope.freeze.witness.protocolDigest = h("f");
  const result = check(f);
  assert.equal(result.requestMetadataConsistent, true);
  assert.equal(result.signatureMathConsistent, false);
  assert.deepEqual(result.blockers, ["UNBOUND_SIGNATURE_CLAIM"]);
});

test("unsupported key, malformed encoding and injected authority flag fail closed", () => {
  const unsupported = fixture();
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  unsupported.claim.claimedPublicKeySpkiPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  assert.deepEqual(check(unsupported).blockers, ["UNSUPPORTED_SIGNATURE_KEY"]);
  const bad = fixture();
  bad.claim.claimedSignatureHex = "non-hex";
  assert.deepEqual(check(bad).blockers, ["INVALID_SIGNATURE_CLAIM"]);
  const injected = fixture();
  (injected.claim as unknown as Record<string, unknown>).independentAuthorityVerified = true;
  assert.deepEqual(check(injected).blockers, ["INVALID_SIGNATURE_CLAIM"]);
});

test("invalid request and getter-bearing claim cannot reach signature verification", () => {
  const revoked = fixture();
  revoked.policy.anchors[0]!.state = "REVOKED";
  assert.deepEqual(check(revoked).blockers, ["REQUEST_NOT_READY"]);
  const accessor = fixture();
  let calls = 0;
  Object.defineProperty(accessor.claim, "claimedSignatureHex", {
    enumerable: true, configurable: true,
    get() { calls++; return "0".repeat(128); },
  });
  assert.deepEqual(check(accessor).blockers, ["INVALID_SIGNATURE_CLAIM"]);
  assert.equal(calls, 0);
});

test("self-re-signing a changed request remains mathematical only, never independent evidence", () => {
  const f = fixture();
  f.envelope.freeze.protocolDigest = h("f");
  f.envelope.freeze.witness.protocolDigest = h("f");
  const rebuilt = buildForwardV02IndependentProofRequest(f.envelope, f.policy, f.refs);
  assert.ok(rebuilt.request);
  const digest = digestForwardV02UntrustedRequest(rebuilt.request);
  // The same caller controls both the key and the replacement signature.
  f.claim.claimedRequestBindingDigest = digest;
  f.claim.claimedSignatureHex = sign(null, Buffer.from(digest, "hex"), f.privateKey).toString("hex");
  const result = check(f);
  assert.equal(result.requestMetadataConsistent, true);
  assert.equal(result.signatureMathConsistent, true);
  assert.equal(result.independentAuthorityVerified, false);
  assert.equal(result.scoringAuthorized, false);
  assert.deepEqual(result.blockers, ["CALLER_SUPPLIED_KEY_NOT_AUTHORITY"]);
});
