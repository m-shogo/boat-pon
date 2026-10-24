import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { buildForwardV02IndependentProofRequest } from "./forwardV02IndependentProofRequest";
import { digestForwardV02UntrustedRequest } from "./forwardV02UntrustedVerifierResponse";
import { assessForwardV02SyntheticEd25519Claim } from "./forwardV02SyntheticEd25519Claim";
import { assessForwardV02SyntheticClaimedAnchorBinding } from "./forwardV02SyntheticClaimedAnchorBinding";
import { assessForwardV02SyntheticReferenceAnchorConflict } from "./forwardV02SyntheticReferenceAnchorConflict";


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

function claimedKeyDigest(pem: string): string {
  return createHash("sha256")
    .update(createPublicKey(pem).export({ format: "der", type: "spki" }))
    .digest("hex");
}
const anchorCheck = (f: ReturnType<typeof fixture>, role: unknown) =>
  assessForwardV02SyntheticClaimedAnchorBinding(
    f.envelope, f.policy, f.refs, f.claim, role,
  );

test("matching caller-claimed witness and settlement keys never grant authority", () => {
  const f = fixture();
  const digest = claimedKeyDigest(f.claim.claimedPublicKeySpkiPem);
  f.policy.anchors[0]!.publicKeyDigest = digest;
  f.policy.anchors[1]!.publicKeyDigest = digest;
  f.claim.claimedSignerId = "synthetic-witness-issuer";
  const witness = anchorCheck(f, "WITNESS");
  assert.equal(witness.signatureMathConsistent, true);
  assert.equal(witness.claimedAnchorKeyDigestMatches, true);
  assert.equal(witness.independentAuthorityVerified, false);
  assert.equal(witness.scoringAuthorized, false);
  assert.deepEqual(witness.blockers, ["CALLER_CLAIMED_ANCHOR_NOT_AUTHORITY"]);
  assert.equal(Object.isFrozen(witness), true);
  assert.equal(Object.isFrozen(witness.blockers), true);
  f.claim.claimedSignerId = "synthetic-settlement-source";
  const settlement = anchorCheck(f, "SETTLEMENT");
  assert.equal(settlement.claimedAnchorKeyDigestMatches, true);
  assert.equal(settlement.independentAuthorityVerified, false);
  assert.equal(settlement.scoringAuthorized, false);
});

test("mathematically valid signature with unrelated claimed anchor digest is rejected", () => {
  const f = fixture();
  f.claim.claimedSignerId = "synthetic-witness-issuer";
  assert.equal(check(f).signatureMathConsistent, true);
  const bound = anchorCheck(f, "WITNESS");
  assert.equal(bound.signatureMathConsistent, true);
  assert.equal(bound.claimedAnchorKeyDigestMatches, false);
  assert.deepEqual(bound.blockers, ["CLAIMED_ANCHOR_KEY_MISMATCH"]);
  assert.equal(bound.scoringAuthorized, false);
});

test("claimed signer and role are bound to their distinct untrusted policy anchors", () => {
  const f = fixture();
  const digest = claimedKeyDigest(f.claim.claimedPublicKeySpkiPem);
  f.policy.anchors[0]!.publicKeyDigest = digest;
  assert.deepEqual(anchorCheck(f, "WITNESS").blockers, ["CLAIMED_SIGNER_MISMATCH"]);
  f.claim.claimedSignerId = "synthetic-witness-issuer";
  assert.deepEqual(anchorCheck(f, "SETTLEMENT").blockers, ["CLAIMED_SIGNER_MISMATCH"]);
  assert.deepEqual(anchorCheck(f, "other").blockers, ["INVALID_CLAIMED_ROLE"]);
  // The settlement key digest must not satisfy the witness role.
  f.policy.anchors[0]!.publicKeyDigest = h("f");
  f.policy.anchors[1]!.publicKeyDigest = digest;
  assert.deepEqual(anchorCheck(f, "WITNESS").blockers, ["CLAIMED_ANCHOR_KEY_MISMATCH"]);
});

test("self-issued claimed anchor and matching signature remain untrusted", () => {
  const f = fixture();
  f.claim.claimedSignerId = "synthetic-witness-issuer";
  f.policy.anchors[0]!.publicKeyDigest = claimedKeyDigest(f.claim.claimedPublicKeySpkiPem);
  f.envelope.freeze.protocolDigest = h("f");
  f.envelope.freeze.witness.protocolDigest = h("f");
  const rebuilt = buildForwardV02IndependentProofRequest(f.envelope, f.policy, f.refs);
  assert.ok(rebuilt.request);
  const digest = digestForwardV02UntrustedRequest(rebuilt.request);
  f.claim.claimedRequestBindingDigest = digest;
  f.claim.claimedSignatureHex = sign(null, Buffer.from(digest, "hex"), f.privateKey).toString("hex");
  const bound = anchorCheck(f, "WITNESS");
  assert.equal(bound.claimedAnchorKeyDigestMatches, true);
  assert.equal(bound.independentAuthorityVerified, false);
  assert.equal(bound.scoringAuthorized, false);
  assert.deepEqual(bound.blockers, ["CALLER_CLAIMED_ANCHOR_NOT_AUTHORITY"]);
});

test("bad signatures, revoked policy and accessor claims fail before claimed anchor correlation", () => {
  const f = fixture();
  f.claim.claimedSignerId = "synthetic-witness-issuer";
  f.policy.anchors[0]!.publicKeyDigest = claimedKeyDigest(f.claim.claimedPublicKeySpkiPem);
  f.claim.claimedSignatureHex = "0".repeat(128);
  assert.deepEqual(anchorCheck(f, "WITNESS").blockers, ["SIGNATURE_NOT_CONSISTENT"]);
  const revoked = fixture();
  revoked.policy.anchors[0]!.state = "REVOKED";
  assert.deepEqual(anchorCheck(revoked, "WITNESS").blockers, ["SIGNATURE_NOT_CONSISTENT"]);
  const accessor = fixture();
  let getterCalls = 0;
  Object.defineProperty(accessor.claim, "claimedSignerId", {
    enumerable: true, configurable: true,
    get() { getterCalls++; return "synthetic-witness-issuer"; },
  });
  assert.deepEqual(anchorCheck(accessor, "WITNESS").blockers, ["SIGNATURE_NOT_CONSISTENT"]);
  assert.equal(getterCalls, 0);
});

function syntheticReference(f: ReturnType<typeof fixture>, role: "WITNESS" | "SETTLEMENT") {
  const digest = claimedKeyDigest(f.claim.claimedPublicKeySpkiPem);
  f.policy.anchors[0]!.publicKeyDigest = digest;
  f.policy.anchors[1]!.publicKeyDigest = digest;
  f.claim.claimedSignerId = role === "WITNESS"
    ? "synthetic-witness-issuer" : "synthetic-settlement-source";
  return {
    schemaVersion: "forward-v02-synthetic-reference-anchor.0.1-untrusted",
    role, authorityId: f.claim.claimedSignerId,
    anchorId: role === "WITNESS" ? "synthetic-witness-anchor" : "synthetic-settlement-anchor",
    publicKeyDigest: digest, state: "ACTIVE",
    validFrom: "2026-10-23T00:00:00Z", validUntil: "2026-10-25T00:00:00Z",
  };
}
const referenceCheck = (f: ReturnType<typeof fixture>, role: unknown, ref: unknown) =>
  assessForwardV02SyntheticReferenceAnchorConflict(
    f.envelope, f.policy, f.refs, f.claim, role, ref,
  );

test("matching synthetic reference for both roles remains untrusted and unscorable", () => {
  for (const role of ["WITNESS", "SETTLEMENT"] as const) {
    const f = fixture();
    const ref = syntheticReference(f, role);
    const r = referenceCheck(f, role, ref);
    assert.equal(r.signatureMathConsistent, true);
    assert.equal(r.claimedAnchorKeyDigestMatches, true);
    assert.equal(r.referenceCorrelationConsistent, true);
    assert.equal(r.independentAuthorityVerified, false);
    assert.equal(r.scoringAuthorized, false);
    assert.deepEqual(r.blockers, ["SYNTHETIC_REFERENCE_NOT_INDEPENDENT_AUTHORITY"]);
    assert.equal(Object.isFrozen(r), true);
    assert.equal(Object.isFrozen(r.blockers), true);
  }
});

test("self-forged matching reference does not become a trust root", () => {
  const f = fixture();
  const forgedBySameCaller = syntheticReference(f, "WITNESS");
  assert.equal(referenceCheck(f, "WITNESS", forgedBySameCaller).independentAuthorityVerified, false);
  assert.equal(referenceCheck(f, "WITNESS", forgedBySameCaller).scoringAuthorized, false);
  assert.deepEqual(referenceCheck(f, "WITNESS", null).blockers, ["SYNTHETIC_REFERENCE_MISSING"]);
});

test("synthetic key rotation, revoked reference and role substitution fail closed", () => {
  const f = fixture();
  const ref = syntheticReference(f, "WITNESS");
  ref.publicKeyDigest = h("0");
  assert.deepEqual(referenceCheck(f, "WITNESS", ref).blockers, ["SYNTHETIC_REFERENCE_KEY_MISMATCH"]);
  ref.publicKeyDigest = claimedKeyDigest(f.claim.claimedPublicKeySpkiPem);
  ref.state = "REVOKED";
  assert.deepEqual(referenceCheck(f, "WITNESS", ref).blockers, ["SYNTHETIC_REFERENCE_REVOKED"]);
  ref.state = "ACTIVE";
  ref.role = "SETTLEMENT";
  assert.deepEqual(referenceCheck(f, "WITNESS", ref).blockers, ["SYNTHETIC_REFERENCE_IDENTITY_MISMATCH"]);
  assert.equal(referenceCheck(f, "WITNESS", ref).scoringAuthorized, false);
});

test("synthetic issuer and anchor substitutions fail independently of caller policy", () => {
  const f = fixture();
  const ref = syntheticReference(f, "SETTLEMENT");
  ref.authorityId = "synthetic-impostor";
  assert.deepEqual(referenceCheck(f, "SETTLEMENT", ref).blockers, ["SYNTHETIC_REFERENCE_IDENTITY_MISMATCH"]);
  ref.authorityId = "synthetic-settlement-source";
  ref.anchorId = "synthetic-other-anchor";
  assert.deepEqual(referenceCheck(f, "SETTLEMENT", ref).blockers, ["SYNTHETIC_REFERENCE_IDENTITY_MISMATCH"]);
});

test("synthetic reference key window must cover claimed witness or settlement clock", () => {
  const witness = fixture();
  const wref = syntheticReference(witness, "WITNESS");
  wref.validFrom = "2026-10-24T00:00:01Z";
  assert.deepEqual(referenceCheck(witness, "WITNESS", wref).blockers, ["SYNTHETIC_REFERENCE_OUT_OF_WINDOW"]);
  const settlement = fixture();
  const sref = syntheticReference(settlement, "SETTLEMENT");
  sref.validUntil = "2026-10-24T00:00:01Z";
  assert.deepEqual(referenceCheck(settlement, "SETTLEMENT", sref).blockers, ["SYNTHETIC_REFERENCE_OUT_OF_WINDOW"]);
});

test("invalid or accessor-bearing synthetic references never execute getters", () => {
  const f = fixture();
  const ref = syntheticReference(f, "WITNESS");
  let getterCalls = 0;
  Object.defineProperty(ref, "publicKeyDigest", {
    enumerable: true, configurable: true,
    get() { getterCalls++; return h("f"); },
  });
  assert.deepEqual(referenceCheck(f, "WITNESS", ref).blockers, ["INVALID_SYNTHETIC_REFERENCE"]);
  assert.equal(getterCalls, 0);
  const bad = syntheticReference(fixture(), "WITNESS");
  (bad as unknown as Record<string, unknown>).scoringAuthorized = true;
  const f2 = fixture();
  syntheticReference(f2, "WITNESS");
  assert.deepEqual(referenceCheck(f2, "WITNESS", bad).blockers, ["INVALID_SYNTHETIC_REFERENCE"]);
});

test("invalid claimed signature cannot borrow a matching synthetic reference", () => {
  const f = fixture();
  const ref = syntheticReference(f, "WITNESS");
  f.claim.claimedSignatureHex = "0".repeat(128);
  const r = referenceCheck(f, "WITNESS", ref);
  assert.equal(r.signatureMathConsistent, false);
  assert.equal(r.referenceCorrelationConsistent, false);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
  assert.deepEqual(r.blockers, ["CLAIMED_ANCHOR_NOT_BOUND"]);
});

test("reference clock traversal does not depend on mutable Array.prototype.map", () => {
  const f = fixture();
  const ref = syntheticReference(f, "SETTLEMENT");
  const originalMap = Array.prototype.map;
  try {
    Array.prototype.map = function (): never { throw new Error("ambient map forbidden"); };
    const r = referenceCheck(f, "SETTLEMENT", ref);
    assert.equal(r.referenceCorrelationConsistent, true);
    assert.equal(r.scoringAuthorized, false);
  } finally {
    Array.prototype.map = originalMap;
  }
});

test("synthetic reference checks every settlement correction timestamp, not just terminal", () => {
  const f = fixture();
  const ref = syntheticReference(f, "SETTLEMENT");
  f.envelope.settlement.revisions[0]!.observedAt = "2026-10-24T00:00:00.500Z";
  f.envelope.settlement.revisions[0]!.sourceFinality = "PROVISIONAL";
  f.envelope.settlement.revisions[1] = {
    revisionId: "synthetic-revision-2", contentDigest: h("e"),
    predecessorDigest: h("d"), sequence: 2,
    observedAt: "2026-10-24T00:00:02Z", sourceFinality: "FINAL",
  };
  // The proof ref must track the terminal correction, not the provisional record.
  f.refs.settlementRevisionId = "synthetic-revision-2";
  // Caller policy covers the full chain. The separate reference starts later:
  // terminal-only checks would incorrectly accept the earlier provisional row.
  ref.validFrom = "2026-10-24T00:00:01Z";
  const predecessorOutside = referenceCheck(f, "SETTLEMENT", ref);
  assert.equal(predecessorOutside.signatureMathConsistent, true);
  assert.equal(predecessorOutside.referenceCorrelationConsistent, false);
  assert.deepEqual(predecessorOutside.blockers, ["SYNTHETIC_REFERENCE_OUT_OF_WINDOW"]);
  assert.equal(predecessorOutside.scoringAuthorized, false);

  // After widening the reference window, every correction is correlated,
  // but the synthetic reference remains untrusted and never admits scoring.
  ref.validFrom = "2026-10-24T00:00:00Z";
  const bothInside = referenceCheck(f, "SETTLEMENT", ref);
  assert.equal(bothInside.referenceCorrelationConsistent, true);
  assert.equal(bothInside.independentAuthorityVerified, false);
  assert.equal(bothInside.scoringAuthorized, false);
  assert.deepEqual(bothInside.blockers, ["SYNTHETIC_REFERENCE_NOT_INDEPENDENT_AUTHORITY"]);

  // Exclusive upper bound must also apply to the terminal revision.
  ref.validUntil = "2026-10-24T00:00:02Z";
  const terminalAtBoundary = referenceCheck(f, "SETTLEMENT", ref);
  assert.equal(terminalAtBoundary.referenceCorrelationConsistent, false);
  assert.deepEqual(terminalAtBoundary.blockers, ["SYNTHETIC_REFERENCE_OUT_OF_WINDOW"]);
  assert.equal(terminalAtBoundary.scoringAuthorized, false);
});
