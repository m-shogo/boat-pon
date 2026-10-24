/**
 * Forward Vault v0.2: minimal, metadata-only request for a FUTURE independent
 * evidence verifier. This is a request builder, not a verifier or scoring gate.
 *
 * Caller-supplied policy, anchor IDs, proof digests and timestamps are claims.
 * They are never trusted here. In particular, a caller-provided REVIEWED policy
 * is not independently provisioned trust material.
 *
 * The request deliberately omits caller policy anchors/public keys, raw
 * settlement values, odds, credentials and private source paths. An eventual
 * separately reviewed verifier must obtain trust roots and source-specific
 * finality/clock rules from an independent authority, not from this request.
 */
import { assessForwardV02TrustPolicyPreflight } from "./forwardV02TrustPolicyPreflight";

export type ForwardV02ClaimedRevision = Readonly<{
  revisionId: string;
  contentDigest: string;
  predecessorDigest: string | null;
  sequence: number;
  claimedObservedAt: string;
  claimedSourceFinality: string;
}>;

export type ForwardV02IndependentProofRequest = Readonly<{
  schemaVersion: "forward-v02-independent-proof-request.0.1-untrusted";
  policySnapshotDigest: string;
  freeze: Readonly<{
    cohortId: string;
    protocolDigest: string;
    membershipDigest: string;
    claimedFirstDecisionAt: string;
    issuerId: string;
    receiptId: string;
    claimedReceiptAt: string;
    claimedAnchorId: string;
    witnessProofDigest: string;
  }>;
  settlement: Readonly<{
    sourceId: string;
    claimedAnchorId: string;
    terminalRevisionId: string;
    settlementProofDigest: string;
    revisions: readonly ForwardV02ClaimedRevision[];
  }>;
}>;

export type ForwardV02ProofRequestAssessment = Readonly<{
  metadataConsistent: boolean;
  independentAuthorityVerified: false;
  scoringAuthorized: false;
  blockers: readonly string[];
  request: ForwardV02IndependentProofRequest | null;
}>;

type Envelope = {
  freeze: {
    cohortId: string; protocolDigest: string; membershipDigest: string;
    firstDecisionAt: string;
    witness: { issuerId: string; receiptId: string; receiptAt: string; trustAnchorId: string };
  };
  settlement: {
    sourceId: string; trustAnchorId: string;
    revisions: {
      revisionId: string; contentDigest: string; predecessorDigest: string | null;
      sequence: number; observedAt: string; sourceFinality: string;
    }[];
  };
};
type Refs = {
  policySnapshotDigest: string; witnessProofDigest: string;
  settlementRevisionId: string; settlementProofDigest: string;
};

function frozenBlockers(input: readonly string[]): readonly string[] {
  // Do not depend on a mutable Array.prototype iterator when copying even
  // internally generated blockers (reuse the canonical iterator guardrail).
  const copy: string[] = [];
  for (let i = 0; i < input.length; i++) copy[i] = input[i]!;
  return Object.freeze(copy);
}

/**
 * Returns only an allowlisted immutable metadata request after existing
 * structural preflight. Even a successful request remains UNVERIFIED and
 * UNSCORABLE. No caller-supplied verifier result or trust root is accepted.
 *
 * Every correction-chain revision is retained in the request, not just FINAL:
 * the eventual independent verifier must authenticate the whole chain.
 */
export function buildForwardV02IndependentProofRequest(
  envelopeInput: unknown, policyInput: unknown, proofRefsInput: unknown,
): ForwardV02ProofRequestAssessment {
  const preflight = assessForwardV02TrustPolicyPreflight(
    envelopeInput, policyInput, proofRefsInput,
  );
  if (!preflight.policyMetadataConsistent) {
    return Object.freeze({
      metadataConsistent: false,
      independentAuthorityVerified: false,
      scoringAuthorized: false,
      blockers: frozenBlockers(preflight.blockers),
      request: null,
    });
  }
  // The preceding strict preflight has already validated the exact envelope,
  // policy and proof-ref shapes. The casts are for copying allowlisted fields.
  const envelope = envelopeInput as Envelope;
  const refs = proofRefsInput as Refs;
  const witness = envelope.freeze.witness;
  const settlement = envelope.settlement;
  const revisions: ForwardV02ClaimedRevision[] = [];
  for (let i = 0; i < settlement.revisions.length; i++) {
    const r = settlement.revisions[i]!;
    revisions.push(Object.freeze({
      revisionId: r.revisionId,
      contentDigest: r.contentDigest,
      predecessorDigest: r.predecessorDigest,
      sequence: r.sequence,
      claimedObservedAt: r.observedAt,
      claimedSourceFinality: r.sourceFinality,
    }));
  }
  const request: ForwardV02IndependentProofRequest = Object.freeze({
    schemaVersion: "forward-v02-independent-proof-request.0.1-untrusted",
    policySnapshotDigest: refs.policySnapshotDigest,
    freeze: Object.freeze({
      cohortId: envelope.freeze.cohortId,
      protocolDigest: envelope.freeze.protocolDigest,
      membershipDigest: envelope.freeze.membershipDigest,
      claimedFirstDecisionAt: envelope.freeze.firstDecisionAt,
      issuerId: witness.issuerId,
      receiptId: witness.receiptId,
      claimedReceiptAt: witness.receiptAt,
      claimedAnchorId: witness.trustAnchorId,
      witnessProofDigest: refs.witnessProofDigest,
    }),
    settlement: Object.freeze({
      sourceId: settlement.sourceId,
      claimedAnchorId: settlement.trustAnchorId,
      terminalRevisionId: refs.settlementRevisionId,
      settlementProofDigest: refs.settlementProofDigest,
      revisions: Object.freeze(revisions),
    }),
  });
  return Object.freeze({
    metadataConsistent: true,
    independentAuthorityVerified: false,
    scoringAuthorized: false,
    blockers: frozenBlockers(preflight.blockers),
    request,
  });
}
