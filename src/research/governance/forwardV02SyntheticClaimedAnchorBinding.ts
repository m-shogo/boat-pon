/**
 * Synthetic, caller-claimed anchor/key correlation for Forward Vault v0.2.
 *
 * This compares an Ed25519 claim with the role/issuer/anchor/key digest in a
 * CALLER-SUPPLIED policy. A matching digest is not an independently provisioned
 * trust root. It cannot establish source authenticity, trusted time, finality,
 * revocation evidence, evaluation eligibility, or scoring permission.
 *
 * Offline metadata and ephemeral synthetic keys only. Never production/admission.
 */
import { createHash, createPublicKey } from "node:crypto";
import { buildForwardV02IndependentProofRequest, snapshotForwardV02UntrustedGraph, snapshotForwardV02UntrustedPolicy } from "./forwardV02IndependentProofRequest";
import { assessForwardV02SyntheticEd25519Claim, snapshotForwardV02SyntheticClaim } from "./forwardV02SyntheticEd25519Claim";
import { digestForwardV02UntrustedRequest } from "./forwardV02UntrustedVerifierResponse";

export type ForwardV02ClaimedAnchorRole = "WITNESS" | "SETTLEMENT";
export type ForwardV02SyntheticClaimedAnchorAssessment = Readonly<{
  signatureMathConsistent: boolean;
  claimedAnchorKeyDigestMatches: boolean;
  independentAuthorityVerified: false;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

function result(
  signatureMathConsistent: boolean,
  claimedAnchorKeyDigestMatches: boolean,
  blocker: string,
): ForwardV02SyntheticClaimedAnchorAssessment {
  return Object.freeze({
    signatureMathConsistent,
    claimedAnchorKeyDigestMatches,
    independentAuthorityVerified: false,
    scoringAuthorized: false,
    blockers: Object.freeze([blocker]),
  });
}

/** Read own data descriptors only; never invoke caller getters or iterators. */
function value(input: unknown, key: string): unknown {
  if (input === null || typeof input !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && descriptor.enumerable && "value" in descriptor
      ? descriptor.value : undefined;
  } catch { return undefined; }
}

/**
 * Checks whether a mathematically valid caller signature also matches the
 * *claimed* role-specific policy key. All policy/key material remains UNTRUSTED.
 * The policy is never used as independent authority or as a scoring gate.
 */
export function assessForwardV02SyntheticClaimedAnchorBinding(
  envelopeInput: unknown, policyInput: unknown, proofRefsInput: unknown,
  claimInput: unknown, roleInput: unknown,
): ForwardV02SyntheticClaimedAnchorAssessment {
  if (roleInput !== "WITNESS" && roleInput !== "SETTLEMENT") {
    return result(false, false, "INVALID_CLAIMED_ROLE");
  }
  // Pin policy before traversing the caller claim: a claim descriptor
  // Proxy can repair an initially mismatching policy anchor before a later
  // policy snapshot. Both inputs remain untrusted and non-atomic.
  const policy = snapshotForwardV02UntrustedPolicy(policyInput);
  if (policy === null) return result(false, false, "SIGNATURE_NOT_CONSISTENT");
  // The same claim Proxy can also repair initially mismatching proof refs.
  // Pin them before claim traversal and reuse the detached graph throughout.
  let refs: unknown;
  try { refs = snapshotForwardV02UntrustedGraph(proofRefsInput); }
  catch { refs = undefined; }
  // Pin every claim field once: a caller-controlled descriptor proxy could
  // otherwise swap the public key after Ed25519 verification but before the
  // claimed policy-key comparison.
  const claim = snapshotForwardV02SyntheticClaim(claimInput);
  if (claim === null) return result(false, false, "SIGNATURE_NOT_CONSISTENT");
  const math = assessForwardV02SyntheticEd25519Claim(
    envelopeInput, policy, refs, claim,
  );
  if (!math.signatureMathConsistent) {
    return result(false, false, "SIGNATURE_NOT_CONSISTENT");
  }
  const built = buildForwardV02IndependentProofRequest(
    envelopeInput, policy, refs,
  );
  if (!built.metadataConsistent || built.request === null) {
    return result(false, false, "REQUEST_NOT_READY");
  }
  // The signature math checked an earlier request snapshot. Caller-owned
  // metadata may change during this separate build, so correlate it again.
  if (value(claim, "claimedRequestBindingDigest") !==
      digestForwardV02UntrustedRequest(built.request)) {
    return result(true, false, "CLAIMED_REQUEST_CHANGED");
  }
  const claimedSignerId = value(claim, "claimedSignerId");
  const claimedPem = value(claim, "claimedPublicKeySpkiPem");
  const expectedAuthority = roleInput === "WITNESS"
    ? built.request.freeze.issuerId : built.request.settlement.sourceId;
  const expectedAnchor = roleInput === "WITNESS"
    ? built.request.freeze.claimedAnchorId : built.request.settlement.claimedAnchorId;
  if (claimedSignerId !== expectedAuthority) {
    return result(true, false, "CLAIMED_SIGNER_MISMATCH");
  }
  const anchors = value(policy, "anchors");
  if (!Array.isArray(anchors) || typeof claimedPem !== "string") {
    return result(true, false, "INVALID_CLAIMED_POLICY");
  }
  try {
    const key = createPublicKey(claimedPem);
    if (key.asymmetricKeyType !== "ed25519") {
      return result(true, false, "UNSUPPORTED_CLAIMED_KEY");
    }
    const keyDigest = createHash("sha256")
      .update(key.export({ format: "der", type: "spki" })).digest("hex");
    let match = false;
    for (let i = 0; i < anchors.length; i++) {
      const anchor = value(anchors, String(i));
      if (value(anchor, "role") === roleInput &&
          value(anchor, "anchorId") === expectedAnchor &&
          value(anchor, "authorityId") === expectedAuthority) {
        match = value(anchor, "publicKeyDigest") === keyDigest;
        break;
      }
    }
    if (!match) return result(true, false, "CLAIMED_ANCHOR_KEY_MISMATCH");
    return result(true, true, "CALLER_CLAIMED_ANCHOR_NOT_AUTHORITY");
  } catch {
    return result(true, false, "INVALID_CLAIMED_KEY");
  }
}
