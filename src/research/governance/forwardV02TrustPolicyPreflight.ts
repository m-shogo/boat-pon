/**
 * Forward Vault v0.2: offline, caller-supplied trust-policy/proof-reference
 * consistency preflight. This is NOT a signature, clock, revocation-log,
 * witness-inclusion, source-finality, or independent trust verifier.
 * Even a syntactically REVIEWED policy is untrusted until separately
 * provisioned and authenticated. There is deliberately no ALLOW path.
 */
import { assessForwardV02AuthorityMetadata } from "./forwardV02AuthorityMetadata";
import { snapshotForwardV02UntrustedGraph, snapshotForwardV02UntrustedGraphRejectingProxies } from "./forwardV02UntrustedSnapshot";

export type ForwardV02TrustPolicyAssessment = Readonly<{
  policyMetadataConsistent: boolean;
  independentAuthorityVerified: false;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

const POLICY_KEYS = ["schemaVersion", "snapshotDigest", "reviewState", "anchors"] as const;
const ANCHOR_KEYS = [
  "anchorId", "authorityId", "role", "algorithm", "publicKeyDigest",
  "state", "validFrom", "validUntil",
] as const;
const REFS_KEYS = [
  "schemaVersion", "policySnapshotDigest", "witnessReceiptId",
  "witnessProofDigest", "settlementRevisionId", "settlementProofDigest",
] as const;
const DIGEST = /^[0-9a-f]{64}$/u;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
type Anchor = {
  anchorId: string; authorityId: string; role: "WITNESS" | "SETTLEMENT";
  algorithm: "Ed25519"; publicKeyDigest: string; state: "ACTIVE" | "REVOKED";
  validFrom: string; validUntil: string;
};
type Policy = { schemaVersion: string; snapshotDigest: string; reviewState: string; anchors: Anchor[] };
type Refs = {
  schemaVersion: string; policySnapshotDigest: string; witnessReceiptId: string;
  witnessProofDigest: string; settlementRevisionId: string; settlementProofDigest: string;
};
type Envelope = {
  freeze: { witness: { issuerId: string; receiptId: string; receiptAt: string; trustAnchorId: string } };
  settlement: {
    sourceId: string; trustAnchorId: string;
    revisions: { revisionId: string; observedAt: string }[];
  };
};
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const p = Object.getPrototypeOf(value);
    if ((p !== Object.prototype && p !== null) || "toJSON" in value ||
        Reflect.ownKeys(value).length !== keys.length) return false;
    for (let i = 0; i < keys.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, keys[i]!);
      if (!d || !d.enumerable || !("value" in d)) return false;
    }
    return true;
  } catch { return false; }
}
function denseArray(value: unknown): value is unknown[] {
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
const nonblank = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const digest = (x: unknown): x is string => typeof x === "string" && DIGEST.test(x);
function utcSeconds(x: unknown): x is string {
  if (typeof x !== "string" || !UTC_SECONDS.test(x) || x.startsWith("0000-")) return false;
  const ms = Date.parse(x);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) + "Z" === x;
}
function validAnchor(x: unknown): x is Anchor {
  if (!exact(x, ANCHOR_KEYS)) return false;
  return nonblank(x.anchorId) && nonblank(x.authorityId) &&
    (x.role === "WITNESS" || x.role === "SETTLEMENT") &&
    x.algorithm === "Ed25519" && digest(x.publicKeyDigest) &&
    (x.state === "ACTIVE" || x.state === "REVOKED") &&
    utcSeconds(x.validFrom) && utcSeconds(x.validUntil) &&
    Date.parse(x.validFrom) < Date.parse(x.validUntil);
}

/**
 * Capture caller-owned policy and refs before any envelope preflight can run
 * user-controlled Proxy descriptor traps. Detached graphs are untrusted: this
 * is only a stable structural comparison, not an authenticated trust root.
 * Mirror the bounded, getter-free graph admission of the proof-request builder.
 */
// Share the exact bounded snapshot guardrail with the request builder.
const snapshotUntrustedPreflight = snapshotForwardV02UntrustedGraph;

function deny(reason: string): ForwardV02TrustPolicyAssessment {
  return Object.freeze({
    policyMetadataConsistent: false, independentAuthorityVerified: false,
    scoringAuthorized: false, blockers: Object.freeze([reason]),
  });
}
function unverified(): ForwardV02TrustPolicyAssessment {
  return Object.freeze({
    policyMetadataConsistent: true, independentAuthorityVerified: false,
    scoringAuthorized: false,
    blockers: Object.freeze(["UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL"]),
  });
}
function boundAnchor(
  anchors: readonly Anchor[], role: Anchor["role"], id: string,
  authority: string, at: string,
): string | null {
  let found: Anchor | undefined;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!;
    if (a.role === role && a.anchorId === id) { found = a; break; }
  }
  if (!found || found.authorityId !== authority) return "UNBOUND_" + role + "_ANCHOR";
  if (found.state !== "ACTIVE") return "REVOKED_" + role + "_ANCHOR";
  const instant = Date.parse(at);
  if (!Number.isFinite(instant) || instant < Date.parse(found.validFrom) ||
      instant >= Date.parse(found.validUntil)) return "OUT_OF_WINDOW_" + role + "_ANCHOR";
  return null;
}

/**
 * All inputs, including a REVIEWED policy snapshot and digest-shaped proof refs,
 * are caller-supplied. Matching them cannot establish an external trust root.
 * A future verifier must use independently provisioned immutable anchors and
 * authenticated source-specific proof/clock/revocation semantics, in a separate
 * reviewed implementation; never reinterpret this return value as admission.
 */
export function assessForwardV02TrustPolicyPreflight(
  envelopeInput: unknown, policyInput: unknown, proofRefsInput: unknown,
): ForwardV02TrustPolicyAssessment {
  try {
    // Pin policy and refs first. Envelope descriptor traps can mutate those
    // caller-owned objects during the envelope's own snapshot or validation.
    // Preserve INVALID_ENVELOPE precedence even when other snapshots fail.
    let policySnapshot: unknown = null, refsSnapshot: unknown = null;
    let policySnapshotFailed = false, refsSnapshotFailed = false;
    try { policySnapshot = snapshotUntrustedPreflight(policyInput); }
    catch { policySnapshotFailed = true; }
    try { refsSnapshot = snapshotUntrustedPreflight(proofRefsInput); }
    catch { refsSnapshotFailed = true; }
    let envelopeSnapshot: unknown;
    try { envelopeSnapshot = snapshotUntrustedPreflight(envelopeInput); }
    catch { return deny("INVALID_ENVELOPE"); }
    envelopeInput = envelopeSnapshot;
    policyInput = policySnapshot;
    proofRefsInput = refsSnapshot;
    if (!assessForwardV02AuthorityMetadata(envelopeInput).metadataConsistent) {
      return deny("INVALID_ENVELOPE");
    }
    if (policySnapshotFailed) return deny("INVALID_POLICY");
    if (refsSnapshotFailed) return deny("INVALID_PROOF_REFS");
    if (!exact(policyInput, POLICY_KEYS) ||
        policyInput.schemaVersion !== "forward-v02-trust-policy.0.1-untrusted" ||
        !digest(policyInput.snapshotDigest) ||
        (policyInput.reviewState !== "DRAFT" && policyInput.reviewState !== "REVIEWED") ||
        !denseArray(policyInput.anchors)) return deny("INVALID_POLICY");
    const anchors: Anchor[] = [];
    const ids = new Set<string>();
    for (let i = 0; i < policyInput.anchors.length; i++) {
      const anchor = Object.getOwnPropertyDescriptor(policyInput.anchors, String(i))?.value;
      if (!validAnchor(anchor)) return deny("INVALID_POLICY");
      const key = anchor.role + ":" + anchor.anchorId;
      if (ids.has(key)) return deny("DUPLICATE_POLICY_ANCHOR");
      ids.add(key);
      // Preserve the exact validated anchor even if ambient Array.prototype.push is patched.
      // A prototype numeric setter must not intercept the validated anchor
      // list either (even though the input graph has already been detached).
      Object.defineProperty(anchors, String(i), {
        value: anchor, enumerable: true, writable: true, configurable: true,
      });
    }
    if (!exact(proofRefsInput, REFS_KEYS) ||
        proofRefsInput.schemaVersion !== "forward-v02-proof-refs.0.1-untrusted" ||
        !digest(proofRefsInput.policySnapshotDigest) ||
        !nonblank(proofRefsInput.witnessReceiptId) ||
        !digest(proofRefsInput.witnessProofDigest) ||
        !nonblank(proofRefsInput.settlementRevisionId) ||
        !digest(proofRefsInput.settlementProofDigest)) return deny("INVALID_PROOF_REFS");
    const policy = policyInput as Policy, refs = proofRefsInput as Refs;
    const envelope = envelopeInput as Envelope;
    const last = envelope.settlement.revisions[envelope.settlement.revisions.length - 1]!;
    if (refs.policySnapshotDigest !== policy.snapshotDigest ||
        refs.witnessReceiptId !== envelope.freeze.witness.receiptId ||
        refs.settlementRevisionId !== last.revisionId) return deny("UNBOUND_PROOF_REFS");
    if (policy.reviewState !== "REVIEWED") return deny("UNREVIEWED_POLICY");
    const witness = envelope.freeze.witness;
    const witnessBlocker = boundAnchor(
      anchors, "WITNESS", witness.trustAnchorId, witness.issuerId, witness.receiptAt,
    );
    if (witnessBlocker) return deny(witnessBlocker);
    const settlement = envelope.settlement;
    // The envelope supplies one settlement trust anchor for its entire
    // correction chain. Checking only the terminal revision would let an
    // out-of-window provisional predecessor borrow the later FINAL revision's
    // valid key window. These are untrusted consistency checks, not proofs.
    for (let i = 0; i < settlement.revisions.length; i++) {
      const revision = settlement.revisions[i]!;
      const settlementBlocker = boundAnchor(
        anchors, "SETTLEMENT", settlement.trustAnchorId, settlement.sourceId, revision.observedAt,
      );
      if (settlementBlocker) return deny(settlementBlocker);
    }
    return unverified();
  } catch { return deny("INVALID_POLICY_OR_PROOF_REFS"); }
}

/**
 * Opt-in, Node-only research ingress for caller-supplied policy preflight.
 * Rejects root/nested/revoked Proxies without executing their traps. Capture
 * policy and proof references before the envelope, then delegate to the
 * unchanged preflight on detached metadata. Preserve INVALID_ENVELOPE >
 * INVALID_POLICY > INVALID_PROOF_REFS failure precedence.
 *
 * This is a structural deny-only check, not independently provisioned trust,
 * verified signatures/time/revocation/finality, atomic concurrent capture,
 * scoring authorization, or production access. Existing callers are unchanged.
 */
export function assessForwardV02TrustPolicyPreflightStrictNodeIngress(
  envelopeInput: unknown, policyInput: unknown, proofRefsInput: unknown,
): ForwardV02TrustPolicyAssessment {
  let policy: unknown, refs: unknown, envelope: unknown;
  let policyFailed = false, refsFailed = false, envelopeFailed = false;
  try { policy = snapshotForwardV02UntrustedGraphRejectingProxies(policyInput); }
  catch { policyFailed = true; }
  try { refs = snapshotForwardV02UntrustedGraphRejectingProxies(proofRefsInput); }
  catch { refsFailed = true; }
  try { envelope = snapshotForwardV02UntrustedGraphRejectingProxies(envelopeInput); }
  catch { envelopeFailed = true; }
  if (envelopeFailed) return deny("INVALID_ENVELOPE");
  if (policyFailed) return deny("INVALID_POLICY");
  if (refsFailed) return deny("INVALID_PROOF_REFS");
  return assessForwardV02TrustPolicyPreflight(envelope, policy, refs);
}
