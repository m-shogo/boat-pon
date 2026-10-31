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
import { snapshotForwardV02UntrustedGraph, snapshotForwardV02UntrustedGraphRejectingProxies } from "./forwardV02UntrustedSnapshot";

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
  for (let i = 0; i < input.length; i++) {
    // Even a deny-only blocker array must not run an inherited index setter.
    Object.defineProperty(copy, String(i), {
      value: input[i]!, enumerable: true, writable: true, configurable: true,
    });
  }
  return Object.freeze(copy);
}

// Keep the existing public import surface for research-only callers.
export { snapshotForwardV02UntrustedGraph } from "./forwardV02UntrustedSnapshot";

/**
 * Pin a caller-owned, UNTRUSTED policy graph before a multi-stage synthetic
 * signature/anchor comparison. This snapshot is not a trust root or authority.
 * Invalid shapes remain subject to the normal strict policy preflight.
 */
export function snapshotForwardV02UntrustedPolicy(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  try {
    const pinned = snapshotForwardV02UntrustedGraph(input);
    return pinned !== null && typeof pinned === "object" && !Array.isArray(pinned)
      ? pinned as Record<string, unknown> : null;
  } catch { return null; }
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
 * Deny local-path-looking tokens in the *exported* request's caller-controlled
 * identifiers. This is a bounded lexical privacy guard, not a general-purpose
 * secret scanner or proof of issuer authority. Preserve benign URI metadata
 * and namespace-style IDs while rejecting synthetic embedded POSIX, Windows,
 * UNC and file-URL paths without reflecting the input in a blocker.
 */
const LOCAL_PATH_TOKEN = /(?:^|[\s=:(\[{,"'])(?:file:\/\/|\\\\|[A-Za-z]:[\\/]|\/(?!\/)[^\s/]+)/iu;
// Decode only bounded percent-encoded layers. Downstream transports may
// interpret encoded absolute paths after the lexical check, so inspect their
// decoded form too. Reject malformed encodings and still-encoded values at the
// depth limit rather than exporting an opaque path-like identifier.
const PERCENT_OCTET = /%[0-9a-f]{2}/iu;
const percentDecode = decodeURIComponent;
function containsLocalPathToken(value: string): boolean {
  let candidate = value;
  for (let depth = 0; depth < 4; depth++) {
    if (LOCAL_PATH_TOKEN.test(candidate)) return true;
    if (!PERCENT_OCTET.test(candidate)) return false;
    try { candidate = percentDecode(candidate); }
    catch { return true; }
  }
  return LOCAL_PATH_TOKEN.test(candidate) || PERCENT_OCTET.test(candidate);
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
  // Pin policy and proof refs before traversing the caller-owned envelope.
  // An envelope descriptor Proxy can otherwise repair a revoked anchor or
  // mismatched proof ref before the later snapshots. Preserve INVALID_ENVELOPE
  // precedence by deferring the other snapshot failures until after capture.
  let envelopeSnapshot: unknown, policySnapshot: unknown, refsSnapshot: unknown;
  let policySnapshotFailed = false, refsSnapshotFailed = false;
  try { policySnapshot = snapshotForwardV02UntrustedGraph(policyInput); }
  catch { policySnapshotFailed = true; }
  try { refsSnapshot = snapshotForwardV02UntrustedGraph(proofRefsInput); }
  catch { refsSnapshotFailed = true; }
  try { envelopeSnapshot = snapshotForwardV02UntrustedGraph(envelopeInput); }
  catch { return snapshotRejected("INVALID_ENVELOPE"); }
  if (policySnapshotFailed) return snapshotRejected("INVALID_POLICY");
  if (refsSnapshotFailed) return snapshotRejected("INVALID_PROOF_REFS");
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
  const identifiers = [
    envelope.freeze.cohortId, witness.issuerId, witness.receiptId,
    witness.trustAnchorId, settlement.sourceId, settlement.trustAnchorId,
    refs.settlementRevisionId,
  ];
  for (let i = 0; i < identifiers.length; i++) {
    if (containsLocalPathToken(identifiers[i]!)) return snapshotRejected("PRIVATE_PATH_METADATA");
  }
  for (let i = 0; i < settlement.revisions.length; i++) {
    if (containsLocalPathToken(settlement.revisions[i]!.revisionId)) {
      return snapshotRejected("PRIVATE_PATH_METADATA");
    }
  }
  const revisions: ForwardV02ClaimedRevision[] = [];
  for (let i = 0; i < settlement.revisions.length; i++) {
    const r = settlement.revisions[i]!;
    // Preserve the complete revision chain even if ambient Array.prototype.push
    // has been replaced (the metadata preflight already uses indexed checks).
    // An inherited numeric setter can replace a validated correction item
    // when assigning into a new array. Define an own index without invoking it.
    Object.defineProperty(revisions, String(i), {
      value: Object.freeze({
        revisionId: r.revisionId,
        contentDigest: r.contentDigest,
        predecessorDigest: r.predecessorDigest,
        sequence: r.sequence,
        claimedObservedAt: r.observedAt,
        claimedSourceFinality: r.sourceFinality,
      }),
      enumerable: true, writable: true, configurable: true,
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

/**
 * Opt-in Node-only ingress for the three caller-owned proof-request graphs.
 * Reject root/nested/revoked Proxies before their traps, and reject accessors
 * without invoking them. Preserve the legacy INVALID_ENVELOPE > INVALID_POLICY
 * > INVALID_PROOF_REFS snapshot-failure precedence.
 *
 * This only creates an UNTRUSTED metadata request. It cannot authenticate a
 * witness, prove settlement finality, provide cross-writer atomicity, authorize
 * scoring, or connect to production. Existing callers remain unchanged.
 */
export function buildForwardV02IndependentProofRequestStrictNodeIngress(
  envelopeInput: unknown, policyInput: unknown, proofRefsInput: unknown,
): ForwardV02ProofRequestAssessment {
  let envelope: unknown, policy: unknown, refs: unknown;
  let envelopeFailed = false, policyFailed = false, refsFailed = false;
  // Capture policy/refs first so even a later ordinary-object mutation cannot
  // repair a previously invalid anchor or proof digest during envelope capture.
  try { policy = snapshotForwardV02UntrustedGraphRejectingProxies(policyInput); }
  catch { policyFailed = true; }
  try { refs = snapshotForwardV02UntrustedGraphRejectingProxies(proofRefsInput); }
  catch { refsFailed = true; }
  try { envelope = snapshotForwardV02UntrustedGraphRejectingProxies(envelopeInput); }
  catch { envelopeFailed = true; }
  if (envelopeFailed) return snapshotRejected("INVALID_ENVELOPE");
  if (policyFailed) return snapshotRejected("INVALID_POLICY");
  if (refsFailed) return snapshotRejected("INVALID_PROOF_REFS");
  return buildForwardV02IndependentProofRequest(envelope, policy, refs);
}
