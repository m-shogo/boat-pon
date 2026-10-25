import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { buildForwardV02IndependentProofRequest } from "./forwardV02IndependentProofRequest";
import { digestForwardV02UntrustedRequest } from "./forwardV02UntrustedVerifierResponse";
import { assessForwardV02SyntheticClaimedAnchorBinding } from "./forwardV02SyntheticClaimedAnchorBinding";
import { assessForwardV02SyntheticReferenceAnchorConflict } from "./forwardV02SyntheticReferenceAnchorConflict";
import {
  assessForwardV02SyntheticClaimedAnchorBindingStrictNodeIngress as strictClaim,
  assessForwardV02SyntheticReferenceAnchorConflictStrictNodeIngress as strictReference,
} from "./forwardV02SyntheticStrictNodeIngress";

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
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const built = buildForwardV02IndependentProofRequest(envelope, policy, refs);
  assert.ok(built.request);
  const binding = digestForwardV02UntrustedRequest(built.request);
  const pem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const claim = {
    schemaVersion: "forward-v02-synthetic-ed25519-claim.0.1-untrusted",
    claimedSignerId: "synthetic-witness-issuer",
    claimedPublicKeySpkiPem: pem,
    claimedRequestBindingDigest: binding,
    claimedSignatureHex: sign(null, Buffer.from(binding, "hex"), privateKey).toString("hex"),
  };
  const digest = createHash("sha256")
    .update(createPublicKey(pem).export({ format: "der", type: "spki" })).digest("hex");
  policy.anchors[0]!.publicKeyDigest = digest;
  const reference = {
    schemaVersion: "forward-v02-synthetic-reference-anchor.0.1-untrusted",
    role: "WITNESS", authorityId: "synthetic-witness-issuer",
    anchorId: "synthetic-witness-anchor", publicKeyDigest: digest,
    state: "ACTIVE", validFrom: "2026-10-23T00:00:00Z",
    validUntil: "2026-10-25T00:00:00Z",
  };
  return { envelope, policy, refs, claim, reference };
}

const claimed = (f: ReturnType<typeof fixture>, envelope: unknown = f.envelope,
  policy: unknown = f.policy, refs: unknown = f.refs, claim: unknown = f.claim) =>
  strictClaim(envelope, policy, refs, claim, "WITNESS");
const referenced = (f: ReturnType<typeof fixture>, envelope: unknown = f.envelope,
  policy: unknown = f.policy, refs: unknown = f.refs, claim: unknown = f.claim,
  reference: unknown = f.reference) =>
  strictReference(envelope, policy, refs, claim, "WITNESS", reference);

test("strict synthetic ingress preserves both ordinary caller-claimed outcomes without authority", () => {
  const f = fixture();
  assert.deepEqual(claimed(f), assessForwardV02SyntheticClaimedAnchorBinding(
    f.envelope, f.policy, f.refs, f.claim, "WITNESS",
  ));
  assert.deepEqual(referenced(f), assessForwardV02SyntheticReferenceAnchorConflict(
    f.envelope, f.policy, f.refs, f.claim, "WITNESS", f.reference,
  ));
  assert.deepEqual(claimed(f).blockers, ["CALLER_CLAIMED_ANCHOR_NOT_AUTHORITY"]);
  assert.deepEqual(referenced(f).blockers, ["SYNTHETIC_REFERENCE_NOT_INDEPENDENT_AUTHORITY"]);
  assert.equal(referenced(f).independentAuthorityVerified, false);
  assert.equal(referenced(f).scoringAuthorized, false);
});

test("strict synthetic ingress rejects root envelope Proxy before it repairs policy", () => {
  const f = fixture();
  f.policy.anchors[0]!.publicKeyDigest = h("0");
  let traps = 0;
  const envelope = new Proxy(f.envelope, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      f.policy.anchors[0]!.publicKeyDigest = f.reference.publicKeyDigest;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(claimed(f, envelope).blockers, ["SIGNATURE_NOT_CONSISTENT"]);
  assert.deepEqual(referenced(f, envelope).blockers, ["CLAIMED_ANCHOR_NOT_BOUND"]);
  assert.equal(traps, 0);
  assert.equal(f.policy.anchors[0]!.publicKeyDigest, h("0"));
});

test("strict synthetic ingress rejects nested policy Proxy before it repairs proof refs", () => {
  const f = fixture();
  f.refs.policySnapshotDigest = h("0");
  let traps = 0;
  const anchor = new Proxy(f.policy.anchors[0]!, {
    getPrototypeOf(target) {
      traps++;
      f.refs.policySnapshotDigest = h("e");
      return Reflect.getPrototypeOf(target);
    },
  });
  f.policy.anchors[0] = anchor;
  assert.equal(claimed(f).claimedAnchorKeyDigestMatches, false);
  assert.equal(referenced(f).referenceCorrelationConsistent, false);
  assert.equal(traps, 0);
  assert.equal(f.refs.policySnapshotDigest, h("0"));
});

test("strict synthetic ingress rejects proof refs Proxy before it repairs the claim", () => {
  const f = fixture();
  const originalSignature = f.claim.claimedSignatureHex;
  f.claim.claimedSignatureHex = "0".repeat(128);
  let traps = 0;
  const refs = new Proxy(f.refs, {
    ownKeys(target) {
      traps++;
      f.claim.claimedSignatureHex = originalSignature;
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(claimed(f, f.envelope, f.policy, refs).blockers, ["SIGNATURE_NOT_CONSISTENT"]);
  assert.deepEqual(referenced(f, f.envelope, f.policy, refs).blockers, ["CLAIMED_ANCHOR_NOT_BOUND"]);
  assert.equal(traps, 0);
  assert.equal(f.claim.claimedSignatureHex, "0".repeat(128));
});

test("strict synthetic ingress rejects claim Proxy before it repairs an earlier envelope", () => {
  const f = fixture();
  f.envelope.freeze.protocolDigest = h("0");
  let traps = 0;
  const claim = new Proxy(f.claim, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      f.envelope.freeze.protocolDigest = h("a");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(claimed(f, f.envelope, f.policy, f.refs, claim).blockers,
    ["SIGNATURE_NOT_CONSISTENT"]);
  assert.deepEqual(referenced(f, f.envelope, f.policy, f.refs, claim).blockers,
    ["CLAIMED_ANCHOR_NOT_BOUND"]);
  assert.equal(traps, 0);
  assert.equal(f.envelope.freeze.protocolDigest, h("0"));
});

test("strict synthetic reference ingress rejects revoked reference Proxy before its repair trap", () => {
  const f = fixture();
  f.reference.state = "REVOKED";
  let traps = 0;
  const reference = new Proxy(f.reference, {
    getPrototypeOf(target) {
      traps++;
      f.reference.state = "ACTIVE";
      return Reflect.getPrototypeOf(target);
    },
  });
  const r = referenced(f, f.envelope, f.policy, f.refs, f.claim, reference);
  assert.equal(r.referenceCorrelationConsistent, false);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
  assert.equal(traps, 0);
  assert.equal(f.reference.state, "REVOKED");
});

test("strict synthetic ingress rejects revoked nested Proxy and getters without executing either", () => {
  const f = fixture();
  let traps = 0, getters = 0;
  const revoked = Proxy.revocable(f.policy.anchors[0]!, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  revoked.revoke();
  f.policy.anchors[0] = revoked.proxy;
  assert.equal(claimed(f).claimedAnchorKeyDigestMatches, false);
  assert.equal(referenced(f).referenceCorrelationConsistent, false);
  assert.equal(traps, 0);
  const g = fixture();
  Object.defineProperty(g.claim, "claimedSignatureHex", {
    enumerable: true, configurable: true,
    get() { getters++; return "0".repeat(128); },
  });
  assert.equal(claimed(g).claimedAnchorKeyDigestMatches, false);
  assert.equal(referenced(g).referenceCorrelationConsistent, false);
  assert.equal(getters, 0);
});

test("strict synthetic ingress retains role priority and ordinary invalid reference decisions", () => {
  const f = fixture();
  const proxy = new Proxy(f.envelope, {
    getPrototypeOf() { throw new Error("must not run"); },
  });
  assert.deepEqual(strictClaim(proxy, f.policy, f.refs, f.claim, "INVALID").blockers,
    ["INVALID_CLAIMED_ROLE"]);
  assert.deepEqual(strictReference(proxy, f.policy, f.refs, f.claim, "INVALID", f.reference).blockers,
    ["INVALID_REFERENCE_ROLE"]);
  f.reference.state = "REVOKED";
  assert.deepEqual(referenced(f), assessForwardV02SyntheticReferenceAnchorConflict(
    f.envelope, f.policy, f.refs, f.claim, "WITNESS", f.reference,
  ));
  assert.deepEqual(referenced(f).blockers, ["SYNTHETIC_REFERENCE_REVOKED"]);
});

test("strict synthetic reference ingress preserves missing-reference classification", () => {
  const f = fixture();
  assert.deepEqual(strictReference(
    f.envelope, f.policy, f.refs, f.claim, "WITNESS", null,
  ).blockers, ["SYNTHETIC_REFERENCE_MISSING"]);
  assert.deepEqual(strictReference(
    f.envelope, f.policy, f.refs, f.claim, "WITNESS", undefined,
  ).blockers, ["SYNTHETIC_REFERENCE_MISSING"]);
});

test("strict synthetic ingress retains SETTLEMENT role and caller-only authority status", () => {
  const f = fixture();
  f.claim.claimedSignerId = "synthetic-settlement-source";
  f.policy.anchors[1]!.publicKeyDigest = f.reference.publicKeyDigest;
  f.reference.role = "SETTLEMENT";
  f.reference.authorityId = "synthetic-settlement-source";
  f.reference.anchorId = "synthetic-settlement-anchor";
  const c = strictClaim(f.envelope, f.policy, f.refs, f.claim, "SETTLEMENT");
  const r = strictReference(
    f.envelope, f.policy, f.refs, f.claim, "SETTLEMENT", f.reference,
  );
  assert.equal(c.signatureMathConsistent, true);
  assert.equal(c.claimedAnchorKeyDigestMatches, true);
  assert.deepEqual(c.blockers, ["CALLER_CLAIMED_ANCHOR_NOT_AUTHORITY"]);
  assert.equal(r.referenceCorrelationConsistent, true);
  assert.deepEqual(r.blockers, ["SYNTHETIC_REFERENCE_NOT_INDEPENDENT_AUTHORITY"]);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});
