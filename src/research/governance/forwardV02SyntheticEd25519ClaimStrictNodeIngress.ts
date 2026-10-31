/**
 * Opt-in, Node-only, research-only ingress for caller-supplied Ed25519 math.
 *
 * The original synthetic signature assessor and its callers remain unchanged.
 * The four caller-owned graphs are detached through the reviewed strict
 * Proxy-rejecting snapshot before any legacy descriptor traversal. A caller
 * Proxy (including nested/revoked) is rejected without executing its traps.
 *
 * This proves at most mathematical consistency of a CALLER-SUPPLIED key.
 * It is not independent authentication, trusted time, settlement finality,
 * cross-writer atomic capture, scoring authorization, or production access.
 */
import { snapshotForwardV02UntrustedGraphRejectingProxies } from "./forwardV02UntrustedSnapshot";
import {
  assessForwardV02SyntheticEd25519Claim,
  type ForwardV02SyntheticSignatureAssessment,
} from "./forwardV02SyntheticEd25519Claim";

function capture(input: unknown): unknown {
  try {
    return snapshotForwardV02UntrustedGraphRejectingProxies(input);
  } catch {
    // Legacy assessor already fail-closes an absent input. Preserve its
    // REQUEST_NOT_READY > INVALID_SIGNATURE_CLAIM diagnostic precedence.
    return undefined;
  }
}

/**
 * Keep policy and proof refs pinned ahead of the claim, and the claim ahead
 * of the envelope. No input graph is traversed by the legacy assessor until
 * every strict capture has finished. The resulting snapshots are untrusted.
 */
export function assessForwardV02SyntheticEd25519ClaimStrictNodeIngress(
  envelopeInput: unknown, policyInput: unknown, proofRefsInput: unknown,
  claimInput: unknown,
): ForwardV02SyntheticSignatureAssessment {
  const policy = capture(policyInput);
  const refs = capture(proofRefsInput);
  const claim = capture(claimInput);
  const envelope = capture(envelopeInput);
  return assessForwardV02SyntheticEd25519Claim(
    envelope, policy, refs, claim,
  );
}
