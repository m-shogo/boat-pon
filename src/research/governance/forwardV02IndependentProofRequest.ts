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
 * Pin the entire caller-owned transcript before validation. A Proxy may return
 * stable own descriptors but different values on later direct property reads.
 * Validate and copy only this detached snapshot, never the original objects.
 *
 * Descriptor-only traversal also rejects accessors, sparse/exotic arrays,
 * symbol keys, cycles and unbounded nesting without executing caller getters.
 * This is a structural snapshot, NOT evidence authentication.
 */
function snapshotUntrusted(input: unknown): unknown {
  let visited = 0;
  function copy(value: unknown, depth: number): unknown {
    if (value === null || typeof value === "string" ||
        typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value !== "object" || depth > 16 || ++visited > 250_000) {
      throw new TypeError("INVALID_SNAPSHOT");
    }
    const isArray = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (isArray ? proto !== Array.prototype
      : (proto !== Object.prototype && proto !== null)) {
      throw new TypeError("INVALID_SNAPSHOT");
    }
    const keys = Reflect.ownKeys(value);
    if (isArray) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      if (!Number.isSafeInteger(length) || length < 0 ||
          length > 250_000 || keys.length !== length + 1) {
        throw new TypeError("INVALID_SNAPSHOT");
      }
      const out: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("INVALID_SNAPSHOT");
        }
        out[i] = copy(descriptor.value, depth + 1);
      }
      return out;
    }
    const out: Record<string, unknown> = Object.create(proto);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (typeof key !== "string") throw new TypeError("INVALID_SNAPSHOT");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("INVALID_SNAPSHOT");
      }
      Object.defineProperty(out, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true, writable: true, configurable: true,
      });
    }
    return out;
  }
  return copy(input, 0);
}

function snapshotRejected(reason: string): ForwardV02ProofRequestAssessment {
  return Object.freeze({
    metadataConsistent: false,
    independentAuthorityVerified: false,
    scoringAuthorized: false,
    blockers: frozenBlockers([reason]),
    request: null,
  });
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
  let envelopeSnapshot: unknown, policySnapshot: unknown, refsSnapshot: unknown;
  try { envelopeSnapshot = snapshotUntrusted(envelopeInput); }
  catch { return snapshotRejected("INVALID_ENVELOPE"); }
  try { policySnapshot = snapshotUntrusted(policyInput); }
  catch { return snapshotRejected("INVALID_POLICY"); }
  try { refsSnapshot = snapshotUntrusted(proofRefsInput); }
  catch { return snapshotRejected("INVALID_PROOF_REFS"); }
  const preflight = assessForwardV02TrustPolicyPreflight(
    envelopeSnapshot, policySnapshot, refsSnapshot,
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
  const envelope = envelopeSnapshot as Envelope;
  const refs = refsSnapshot as Refs;
  const witness = envelope.freeze.witness;
  const settlement = envelope.settlement;
  const revisions: ForwardV02ClaimedRevision[] = [];
  for (let i = 0; i < settlement.revisions.length; i++) {
    const r = settlement.revisions[i]!;
    // Preserve the complete revision chain even if ambient Array.prototype.push
    // has been replaced (the metadata preflight already uses indexed checks).
    revisions[i] = Object.freeze({
      revisionId: r.revisionId,
      contentDigest: r.contentDigest,
      predecessorDigest: r.predecessorDigest,
      sequence: r.sequence,
      claimedObservedAt: r.observedAt,
      claimedSourceFinality: r.sourceFinality,
    });
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
