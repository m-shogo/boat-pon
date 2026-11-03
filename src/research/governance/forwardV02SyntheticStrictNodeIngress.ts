/**
 * Opt-in, Node-only Proxy-rejecting ingress for synthetic anchor correlation.
 *
 * The legacy assessors are deliberately unchanged. Caller-owned metadata is
 * detached before either assessor traverses it; a nested/revoked Proxy is
 * rejected by Node's util.types.isProxy before any of its traps can run.
 *
 * These functions are deny-only RESEARCH helpers. Even matching signatures,
 * anchors and synthetic references never establish independent authority,
 * trusted time, settlement finality, scoring permission or production access.
 * Separate inputs are not an atomic snapshot against external writers.
 */
import { snapshotForwardV02UntrustedGraphRejectingProxies } from "./forwardV02UntrustedSnapshot";
import {
  assessForwardV02SyntheticClaimedAnchorBinding,
  type ForwardV02SyntheticClaimedAnchorAssessment,
} from "./forwardV02SyntheticClaimedAnchorBinding";
import {
  assessForwardV02SyntheticReferenceAnchorConflict,
  type ForwardV02SyntheticReferenceAssessment,
} from "./forwardV02SyntheticReferenceAnchorConflict";

type Capture = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }>;

function capture(input: unknown): Capture {
  try {
    return { ok: true, value: snapshotForwardV02UntrustedGraphRejectingProxies(input) };
  } catch {
    return { ok: false };
  }
}

function deniedClaim(reason: string): ForwardV02SyntheticClaimedAnchorAssessment {
  return Object.freeze({
    signatureMathConsistent: false,
    claimedAnchorKeyDigestMatches: false,
    independentAuthorityVerified: false,
    scoringAuthorized: false,
    blockers: Object.freeze([reason]),
  });
}

function deniedReference(reason: string): ForwardV02SyntheticReferenceAssessment {
  return Object.freeze({
    signatureMathConsistent: false,
    claimedAnchorKeyDigestMatches: false,
    referenceCorrelationConsistent: false,
    independentAuthorityVerified: false,
    scoringAuthorized: false,
    blockers: Object.freeze([reason]),
  });
}

/**
 * Snapshot policy, proof refs and claim before envelope traversal. Reject
 * caller Proxies rather than trying another incompatible descriptor order.
 * Invalid roles retain their legacy priority without inspecting any input.
 */
export function assessForwardV02SyntheticClaimedAnchorBindingStrictNodeIngress(
  envelopeInput: unknown, policyInput: unknown, proofRefsInput: unknown,
  claimInput: unknown, roleInput: unknown,
): ForwardV02SyntheticClaimedAnchorAssessment {
  if (roleInput !== "WITNESS" && roleInput !== "SETTLEMENT") {
    return deniedClaim("INVALID_CLAIMED_ROLE");
  }
  const policy = capture(policyInput);
  const refs = capture(proofRefsInput);
  const claim = capture(claimInput);
  const envelope = capture(envelopeInput);
  if (!policy.ok || !refs.ok || !claim.ok || !envelope.ok) {
    return deniedClaim("SIGNATURE_NOT_CONSISTENT");
  }
  return assessForwardV02SyntheticClaimedAnchorBinding(
    envelope.value, policy.value, refs.value, claim.value, roleInput,
  );
}

/**
 * Snapshot the separate synthetic reference before all other caller graphs,
 * preserving its earlier capture priority. A missing reference is still
 * delegated to the legacy MISSING decision after signature correlation.
 */
export function assessForwardV02SyntheticReferenceAnchorConflictStrictNodeIngress(
  envelopeInput: unknown, policyInput: unknown, proofRefsInput: unknown,
  claimInput: unknown, roleInput: unknown, referenceInput: unknown,
): ForwardV02SyntheticReferenceAssessment {
  if (roleInput !== "WITNESS" && roleInput !== "SETTLEMENT") {
    return deniedReference("INVALID_REFERENCE_ROLE");
  }
  // Missing is a distinct legacy outcome, not a malformed Proxy graph.
  const reference = referenceInput === null || referenceInput === undefined
    ? { ok: true as const, value: referenceInput } : capture(referenceInput);
  const policy = capture(policyInput);
  const refs = capture(proofRefsInput);
  const claim = capture(claimInput);
  const envelope = capture(envelopeInput);
  if (!reference.ok || !policy.ok || !refs.ok || !claim.ok || !envelope.ok) {
    return deniedReference("CLAIMED_ANCHOR_NOT_BOUND");
  }
  return assessForwardV02SyntheticReferenceAnchorConflict(
    envelope.value, policy.value, refs.value, claim.value, roleInput,
    reference.value,
  );
}
