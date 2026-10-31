import { validForwardV02ClaimedInstant as instant, compareForwardV02ClaimedInstants as compareInstants } from "./forwardV02ClaimedInstant";
import { snapshotForwardV02UntrustedGraph, snapshotForwardV02UntrustedGraphRejectingProxies } from "./forwardV02UntrustedSnapshot";

/**
 * UNTRUSTED, research-only v0.2 evidence metadata preflight.
 * This deliberately has no trusted keys, network access, proof verification,
 * final settlement selection, ROI, or scoring/production authorization path.
 * A matching caller-provided signature/digest/clock is NOT an attestation.
 */
export type ForwardV02AuthorityMetadataAssessment = Readonly<{
  metadataConsistent: boolean;
  freezeStatus: string;
  settlementStatus: string;
  independentAuthorityVerified: false;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

const ROOT = ["schemaVersion", "evidenceStage", "freeze", "settlement"] as const;
const FREEZE = ["cohortId", "protocolDigest", "membershipDigest", "firstDecisionAt", "expectedMembership", "includedMembership", "excludedMembership", "witness"] as const;
const WITNESS = ["receiptId", "issuerId", "receiptAt", "protocolDigest", "membershipDigest", "signatureDigest", "trustAnchorId"] as const;
const SETTLEMENT = ["expectedDecisionId", "decisionId", "expectedTicketKey", "ticketKey", "sourceId", "trustAnchorId", "disposition", "evaluable", "revisions"] as const;
const REVISION = ["revisionId", "contentDigest", "predecessorDigest", "sequence", "observedAt", "sourceFinality"] as const;
const SHA = /^[0-9a-f]{64}$/u;

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const p = Object.getPrototypeOf(value);
    if ((p !== Object.prototype && p !== null) || "toJSON" in value || Reflect.ownKeys(value).length !== keys.length) return false;
    for (let i = 0; i < keys.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, keys[i]!);
      if (!d || !d.enumerable || !("value" in d)) return false;
    }
    return true;
  } catch { return false; }
}
function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function sha(value: unknown): value is string {
  return typeof value === "string" && SHA.test(value);
}
function stringList(value: unknown, allowEmpty = false): value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || "toJSON" in value ||
        Reflect.ownKeys(value).length !== value.length + 1) return false;
    const seen = new Set<string>();
    for (let i = 0; i < value.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d || !d.enumerable || !("value" in d) || !nonblank(d.value) || seen.has(d.value)) return false;
      seen.add(d.value);
    }
    return true;
  } catch { return false; }
}
function exactArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || "toJSON" in value ||
        Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let i = 0; i < value.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d || !d.enumerable || !("value" in d)) return false;
    }
    return true;
  } catch { return false; }
}
const result = (freezeStatus: string, settlementStatus: string): ForwardV02AuthorityMetadataAssessment => {
  const consistent = freezeStatus === "STRUCTURALLY_VALID_UNATTESTED" &&
    settlementStatus === "STRUCTURALLY_VALID_UNATTESTED";
  return Object.freeze({
    metadataConsistent: consistent, freezeStatus, settlementStatus,
    independentAuthorityVerified: false, scoringAuthorized: false,
    blockers: Object.freeze(consistent
      ? ["UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL"]
      : [freezeStatus !== "STRUCTURALLY_VALID_UNATTESTED" ? freezeStatus : settlementStatus]),
  });
};

/** Structural classification only. All caller-provided trust claims remain unverified. */
export function assessForwardV02AuthorityMetadata(input: unknown): ForwardV02AuthorityMetadataAssessment {
  const good = "STRUCTURALLY_VALID_UNATTESTED";
  try {
    // Pin the complete caller graph before any semantic validation. Own-data
    // descriptors, not subsequent Proxy property reads, define this snapshot.
    // A structurally consistent claim is still neither attested nor scorable.
    input = snapshotForwardV02UntrustedGraph(input);
    if (!exact(input, ROOT) || input.schemaVersion !== "forward-v02-authority-metadata.0.1-untrusted") {
      return result("INVALID_EVIDENCE_SHAPE", "INVALID_EVIDENCE_SHAPE");
    }
    if (input.evidenceStage !== "SHADOW_FORWARD" && input.evidenceStage !== "FUTURE_ONLY") {
      return result("UNSUPPORTED_STAGE", "UNSUPPORTED_STAGE");
    }
    const f = input.freeze, s = input.settlement;
    if (!exact(f, FREEZE) || !exact(s, SETTLEMENT) || !exact(f.witness, WITNESS)) {
      return result("INVALID_EVIDENCE_SHAPE", "INVALID_EVIDENCE_SHAPE");
    }
    const w = f.witness;
    if (!nonblank(f.cohortId) || !sha(f.protocolDigest) || !sha(f.membershipDigest) ||
        !instant(f.firstDecisionAt) || !stringList(f.expectedMembership) ||
        !stringList(f.includedMembership, true) || !stringList(f.excludedMembership, true) ||
        !nonblank(w.receiptId) || !nonblank(w.issuerId) || !instant(w.receiptAt) ||
        !sha(w.protocolDigest) || !sha(w.membershipDigest) || !sha(w.signatureDigest) ||
        !nonblank(w.trustAnchorId)) return result("INVALID_EVIDENCE_SHAPE", "INVALID_EVIDENCE_SHAPE");
    if (w.protocolDigest !== f.protocolDigest || w.membershipDigest !== f.membershipDigest) {
      return result("CONFLICT", good);
    }
    if (compareInstants(w.receiptAt, f.firstDecisionAt) >= 0) return result("AFTER_DECISION", good);
    // Never consume caller arrays via mutable Array.prototype[Symbol.iterator].
    const expected = new Set<string>();
    for (let i = 0; i < f.expectedMembership.length; i++) expected.add(f.expectedMembership[i]!);
    const covered = new Set<string>();
    const included = new Set<string>();
    for (let i = 0; i < f.includedMembership.length; i++) {
      const id = f.includedMembership[i]!;
      if (!expected.has(id) || covered.has(id)) return result("CONFLICT", good);
      covered.add(id);
      included.add(id);
    }
    for (let i = 0; i < f.excludedMembership.length; i++) {
      const id = f.excludedMembership[i]!;
      if (!expected.has(id) || covered.has(id)) return result("CONFLICT", good);
      covered.add(id);
    }
    if (covered.size !== expected.size) return result("MISSING_MEMBERSHIP", good);
    if (!nonblank(s.expectedDecisionId) || !nonblank(s.decisionId) ||
        !nonblank(s.expectedTicketKey) || !nonblank(s.ticketKey) ||
        !nonblank(s.sourceId) || !nonblank(s.trustAnchorId) ||
        typeof s.evaluable !== "boolean" || !exactArray(s.revisions)) {
      return result(good, "INVALID_EVIDENCE_SHAPE");
    }
    if (s.expectedDecisionId !== s.decisionId || s.expectedTicketKey !== s.ticketKey ||
        !expected.has(s.decisionId)) return result(good, "UNRESOLVED_IDENTITY");
    if (s.disposition !== "SETTLED" && s.disposition !== "REFUNDED" &&
        s.disposition !== "VOID" && s.disposition !== "CANCELLED" &&
        s.disposition !== "UNRESOLVED") return result(good, "INVALID_EVIDENCE_SHAPE");
    if ((s.disposition === "SETTLED") !== s.evaluable) {
      return result(good, "UNRESOLVED_REFUND_OR_INVALIDATION");
    }
    // A caller cannot score a terminal SETTLED result for a decision that
    // the same frozen membership envelope explicitly excluded. Preserve
    // non-evaluable refund/void evidence without promoting it to scoring.
    if (s.evaluable && !included.has(s.decisionId)) return result(good, "CONFLICT");
    const ids = new Set<string>(), digests = new Set<string>();
    let predecessor: string | null = null;
    let previousAt: string | null = null;
    for (let i = 0; i < s.revisions.length; i++) {
      const r = s.revisions[i];
      if (!exact(r, REVISION) || !nonblank(r.revisionId) || !sha(r.contentDigest) ||
          (r.predecessorDigest !== null && !sha(r.predecessorDigest)) ||
          !Number.isSafeInteger(r.sequence) || r.sequence !== i + 1 ||
          !instant(r.observedAt) ||
          (r.sourceFinality !== "PROVISIONAL" && r.sourceFinality !== "FINAL" &&
           r.sourceFinality !== "REVOKED")) return result(good, "INVALID_EVIDENCE_SHAPE");
      // Even a provisional settlement revision cannot predate its decision.
      // A later FINAL label must not launder a predecision result into a valid chain.
      if (compareInstants(r.observedAt, f.firstDecisionAt) <= 0) {
        return result(good, "UNRESOLVED_FINALITY");
      }
      if (ids.has(r.revisionId) || digests.has(r.contentDigest)) return result(good, "CONFLICT");
      if (r.predecessorDigest !== predecessor) return result(good, "INCOMPLETE_REVISION_CHAIN");
      if (previousAt !== null && compareInstants(r.observedAt, previousAt) <= 0) {
        return result(good, "CONFLICT");
      }
      ids.add(r.revisionId); digests.add(r.contentDigest);
      predecessor = r.contentDigest; previousAt = r.observedAt;
    }
    const terminal = s.revisions[s.revisions.length - 1] as Record<string, unknown>;
    if (terminal.sourceFinality !== "FINAL" ||
        compareInstants(terminal.observedAt as string, f.firstDecisionAt) <= 0) {
      return result(good, "UNRESOLVED_FINALITY");
    }
    return result(good, good);
  } catch { return result("INVALID_EVIDENCE_SHAPE", "INVALID_EVIDENCE_SHAPE"); }
}

/**
 * Opt-in, research-only Node ingress for one untrusted authority envelope.
 * Rejects all encountered caller Proxies before their traps run, then reuses
 * the existing semantic assessment on detached data. Legacy callers are
 * deliberately unchanged; neither outcome is independent authentication.
 *
 * This is not an atomic multi-input or concurrent-mutation guarantee.
 */
export function assessForwardV02AuthorityMetadataStrictNodeIngress(
  input: unknown,
): ForwardV02AuthorityMetadataAssessment {
  try {
    return assessForwardV02AuthorityMetadata(
      snapshotForwardV02UntrustedGraphRejectingProxies(input),
    );
  } catch {
    return result("INVALID_EVIDENCE_SHAPE", "INVALID_EVIDENCE_SHAPE");
  }
}
