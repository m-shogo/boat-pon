/**
 * Research-only cross-envelope identity replay preflight for UNTRUSTED v0.2 metadata.
 * This compares caller-supplied records, NOT signatures, independent witness receipts,
 * authoritative source revisions, or trust anchors. Never grants scoring authority.
 */
import { assessForwardV02AuthorityMetadata } from "./forwardV02AuthorityMetadata";
import { snapshotForwardV02UntrustedGraphRejectingProxies } from "./forwardV02UntrustedSnapshot";
import { snapshotForwardV02UntrustedGraph } from "./forwardV02IndependentProofRequest";

export type ForwardV02AuthorityBatchAssessment = Readonly<{
  metadataConsistent: boolean;
  independentAuthorityVerified: false;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

type Witness = {
  issuerId: string; receiptId: string; receiptAt: string; signatureDigest: string; trustAnchorId: string;
};
type Freeze = {
  cohortId: string; protocolDigest: string; membershipDigest: string; firstDecisionAt: string;
  expectedMembership: string[]; includedMembership: string[]; excludedMembership: string[];
  witness: Witness;
};
type Revision = {
  revisionId: string; contentDigest: string; predecessorDigest: string | null;
  sequence: number; observedAt: string; sourceFinality: string;
};
type Settlement = {
  decisionId: string; ticketKey: string; sourceId: string; trustAnchorId: string;
  disposition: string; evaluable: boolean; revisions: Revision[];
};
type Envelope = { freeze: Freeze; settlement: Settlement };

// A deny-only result must remain deny-only even when passed to an untrusted
// consumer. TypeScript's literal-false type does not prevent runtime mutation.
const deny = (reason: string): ForwardV02AuthorityBatchAssessment => Object.freeze({
  metadataConsistent: false, independentAuthorityVerified: false,
  scoringAuthorized: false, blockers: Object.freeze([reason]),
});
const unverified = (): ForwardV02AuthorityBatchAssessment => Object.freeze({
  metadataConsistent: true, independentAuthorityVerified: false,
  scoringAuthorized: false,
  blockers: Object.freeze(["UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL"]),
});

function denseOwnDataArray(input: unknown): input is unknown[] {
  if (!Array.isArray(input) || input.length === 0) return false;
  try {
    if (Object.getPrototypeOf(input) !== Array.prototype ||
        "toJSON" in input || Reflect.ownKeys(input).length !== input.length + 1) return false;
    for (let i = 0; i < input.length; i++) {
      const d = Object.getOwnPropertyDescriptor(input, String(i));
      if (!d || !d.enumerable || !("value" in d)) return false;
    }
    return true;
  } catch { return false; }
}
function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function sameReceipt(a: Freeze, b: Freeze): boolean {
  return a.cohortId === b.cohortId &&
    a.protocolDigest === b.protocolDigest && a.membershipDigest === b.membershipDigest &&
    a.firstDecisionAt === b.firstDecisionAt &&
    a.witness.receiptAt === b.witness.receiptAt &&
    a.witness.signatureDigest === b.witness.signatureDigest &&
    a.witness.trustAnchorId === b.witness.trustAnchorId &&
    sameList(a.expectedMembership, b.expectedMembership) &&
    sameList(a.includedMembership, b.includedMembership) &&
    sameList(a.excludedMembership, b.excludedMembership);
}
function sameRevision(a: Settlement, ar: Revision, b: Settlement, br: Revision): boolean {
  return a.decisionId === b.decisionId && a.ticketKey === b.ticketKey &&
    a.trustAnchorId === b.trustAnchorId && a.disposition === b.disposition &&
    a.evaluable === b.evaluable && ar.contentDigest === br.contentDigest &&
    ar.predecessorDigest === br.predecessorDigest && ar.sequence === br.sequence &&
    ar.observedAt === br.observedAt && ar.sourceFinality === br.sourceFinality;
}

/**
 * Reject conflicting reuse of issuer-scoped receipt IDs or source-scoped revision IDs
 * across individually well-formed untrusted envelopes. Identical repeats are idempotent.
 * Source/issuer identity is caller-reported; a clean result is NOT external attestation.
 */
export function assessForwardV02AuthorityBatch(input: unknown): ForwardV02AuthorityBatchAssessment {
  try {
    // Do not probe a caller-controlled array before taking its snapshot:
    // reading .length or checking "toJSON" in a Proxy can run traps that
    // repair an initially conflicting receipt/revision before capture.
    // The descriptor-only snapshot is the first admission boundary; then
    // validate the detached batch and build replay maps from it alone.
    // This is structural quarantine, NOT independent attestation.
    const pinned = snapshotForwardV02UntrustedGraph(input);
    if (!denseOwnDataArray(pinned)) return deny("INVALID_BATCH");
    const receipts = new Map<string, Map<string, Freeze>>();
    const revisions = new Map<string, Map<string, { settlement: Settlement; revision: Revision }>>();
    for (let i = 0; i < pinned.length; i++) {
      const value = pinned[i];
      if (!assessForwardV02AuthorityMetadata(value).metadataConsistent) return deny("INVALID_ENVELOPE");
      const envelope = value as Envelope;
      const f = envelope.freeze, s = envelope.settlement, w = f.witness;
      let issuerReceipts = receipts.get(w.issuerId);
      if (!issuerReceipts) { issuerReceipts = new Map(); receipts.set(w.issuerId, issuerReceipts); }
      const earlier = issuerReceipts.get(w.receiptId);
      if (earlier && !sameReceipt(earlier, f)) return deny("RECEIPT_REPLAY_CONFLICT");
      if (!earlier) issuerReceipts.set(w.receiptId, f);
      let sourceRevisions = revisions.get(s.sourceId);
      if (!sourceRevisions) { sourceRevisions = new Map(); revisions.set(s.sourceId, sourceRevisions); }
      for (let j = 0; j < s.revisions.length; j++) {
        const revision = s.revisions[j]!;
        const prior = sourceRevisions.get(revision.revisionId);
        if (prior && !sameRevision(prior.settlement, prior.revision, s, revision)) {
          return deny("SOURCE_REVISION_REPLAY_CONFLICT");
        }
        if (!prior) sourceRevisions.set(revision.revisionId, { settlement: s, revision });
      }
    }
    return unverified();
  } catch { return deny("INVALID_BATCH"); }
}

/**
 * Opt-in, Node-only, research ingress for an entire caller-supplied batch.
 * Rejects root/nested/revoked Proxies before their traps, then delegates to
 * the unchanged batch replay comparison on detached, untrusted metadata.
 * This is neither external attestation nor atomic capture against concurrent
 * mutation of ordinary objects; it never grants scoring or production rights.
 */
export function assessForwardV02AuthorityBatchStrictNodeIngress(
  input: unknown,
): ForwardV02AuthorityBatchAssessment {
  try {
    return assessForwardV02AuthorityBatch(
      snapshotForwardV02UntrustedGraphRejectingProxies(input),
    );
  } catch {
    return deny("INVALID_BATCH");
  }
}
