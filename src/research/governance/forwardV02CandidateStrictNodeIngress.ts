/**
 * Opt-in Node-only research ingress for an unapproved v0.2 protocol candidate.
 * Rejects root, nested and revoked caller Proxies before their traps, and
 * accessors without invoking getters. Delegates only detached metadata to
 * the unchanged standalone candidate assessor; legacy callers are untouched.
 *
 * Completeness is not independent enrollment, trusted source evidence,
 * approved scoring, atomic concurrent capture, or production authorization.
 */
import { snapshotForwardV02UntrustedGraphRejectingProxies } from "./forwardV02UntrustedSnapshot";
import {
  assessForwardV02Candidate,
  type ForwardV02CandidateAssessment,
} from "./forwardEvaluationProtocolV02Candidate";

export function assessForwardV02CandidateStrictNodeIngress(
  input: unknown,
): ForwardV02CandidateAssessment {
  try {
    return assessForwardV02Candidate(
      snapshotForwardV02UntrustedGraphRejectingProxies(input),
    );
  } catch {
    // Keep the opt-in strict-ingress denial immutable at runtime, just like
    // the legacy candidate assessment's rejected/unapproved results.
    return Object.freeze({
      candidateComplete: false, scoringAuthorized: false,
      blockers: Object.freeze(["INVALID_CANDIDATE_SHAPE"]),
    });
  }
}
