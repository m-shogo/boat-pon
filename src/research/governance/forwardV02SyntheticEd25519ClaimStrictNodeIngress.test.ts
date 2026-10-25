import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { buildForwardV02IndependentProofRequest } from "./forwardV02IndependentProofRequest";
import { digestForwardV02UntrustedRequest } from "./forwardV02UntrustedVerifierResponse";
import { assessForwardV02SyntheticEd25519Claim } from "./forwardV02SyntheticEd25519Claim";
import { assessForwardV02SyntheticEd25519ClaimStrictNodeIngress as strict } from "./forwardV02SyntheticEd25519ClaimStrictNodeIngress";

const h = (digit: string) => digit.repeat(64);

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
  return { envelope, policy, refs, claim };
}

const run = (f: ReturnType<typeof fixture>, envelope: unknown = f.envelope,
  policy: unknown = f.policy, refs: unknown = f.refs, claim: unknown = f.claim) =>
  strict(envelope, policy, refs, claim);

test("strict signature ingress preserves valid caller-key math without authority", () => {
  const f = fixture();
  assert.deepEqual(run(f), assessForwardV02SyntheticEd25519Claim(
    f.envelope, f.policy, f.refs, f.claim,
  ));
  assert.deepEqual(run(f).blockers, ["CALLER_SUPPLIED_KEY_NOT_AUTHORITY"]);
  assert.equal(run(f).independentAuthorityVerified, false);
  assert.equal(run(f).scoringAuthorized, false);
});

test("strict signature ingress retains changed-request binding rejection", () => {
  const f = fixture();
  f.envelope.freeze.protocolDigest = h("f");
  f.envelope.freeze.witness.protocolDigest = h("f");
  assert.deepEqual(run(f).blockers, ["UNBOUND_SIGNATURE_CLAIM"]);
  assert.equal(run(f).signatureMathConsistent, false);
});

test("strict signature ingress rejects root envelope Proxy before policy repair", () => {
  const f = fixture();
  f.policy.anchors[0]!.state = "REVOKED";
  let traps = 0;
  const envelope = new Proxy(f.envelope, {
    ownKeys(target) {
      traps++;
      f.policy.anchors[0]!.state = "ACTIVE";
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(run(f, envelope).blockers, ["REQUEST_NOT_READY"]);
  assert.equal(traps, 0);
  assert.equal(f.policy.anchors[0]!.state, "REVOKED");
});

test("strict signature ingress rejects nested policy Proxy before proof-ref repair", () => {
  const f = fixture();
  f.refs.policySnapshotDigest = h("0");
  let traps = 0;
  f.policy.anchors[0] = new Proxy(f.policy.anchors[0]!, {
    getPrototypeOf(target) {
      traps++;
      f.refs.policySnapshotDigest = h("e");
      return Reflect.getPrototypeOf(target);
    },
  });
  assert.deepEqual(run(f).blockers, ["REQUEST_NOT_READY"]);
  assert.equal(traps, 0);
  assert.equal(f.refs.policySnapshotDigest, h("0"));
});

test("strict signature ingress rejects proof-ref Proxy before signature repair", () => {
  const f = fixture();
  const signature = f.claim.claimedSignatureHex;
  f.claim.claimedSignatureHex = "0".repeat(128);
  let traps = 0;
  const refs = new Proxy(f.refs, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      f.claim.claimedSignatureHex = signature;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(run(f, f.envelope, f.policy, refs).blockers, ["REQUEST_NOT_READY"]);
  assert.equal(traps, 0);
  assert.equal(f.claim.claimedSignatureHex, "0".repeat(128));
});

test("strict signature ingress rejects claim Proxy before signature or envelope repair", () => {
  const f = fixture();
  const signature = f.claim.claimedSignatureHex;
  f.claim.claimedSignatureHex = "0".repeat(128);
  let traps = 0;
  const claim = new Proxy(f.claim, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      f.claim.claimedSignatureHex = signature;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(run(f, f.envelope, f.policy, f.refs, claim).blockers,
    ["INVALID_SIGNATURE_CLAIM"]);
  assert.equal(traps, 0);
  assert.equal(f.claim.claimedSignatureHex, "0".repeat(128));
});

test("strict signature ingress rejects revoked nested Proxy and accessor without traps", () => {
  const f = fixture();
  let traps = 0;
  const revoked = Proxy.revocable(f.policy.anchors[0]!, {
    ownKeys(target) {
      traps++;
      return Reflect.ownKeys(target);
    },
  });
  revoked.revoke();
  f.policy.anchors[0] = revoked.proxy;
  assert.deepEqual(run(f).blockers, ["REQUEST_NOT_READY"]);
  assert.equal(traps, 0);

  const g = fixture();
  let getters = 0;
  Object.defineProperty(g.claim, "claimedSignatureHex", {
    enumerable: true, configurable: true,
    get() { getters++; return "0".repeat(128); },
  });
  assert.deepEqual(run(g).blockers, ["INVALID_SIGNATURE_CLAIM"]);
  assert.equal(getters, 0);
});

test("strict signature ingress retains request-first error precedence", () => {
  const f = fixture();
  f.policy.anchors[0]!.state = "REVOKED";
  f.claim.claimedSignatureHex = "not-hex";
  assert.deepEqual(run(f).blockers, ["REQUEST_NOT_READY"]);
  assert.equal(run(f).independentAuthorityVerified, false);
  assert.equal(run(f).scoringAuthorized, false);
});
