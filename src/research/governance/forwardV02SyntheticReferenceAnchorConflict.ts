/**
 * Synthetic reference-anchor correlation for Forward Vault v0.2.
 *
 * Models the *shape* of a verifier-side anchor comparison using a second
 * caller-supplied fixture. This is NOT an independently provisioned trust
 * store: callers can forge both inputs. A matching result NEVER authenticates
 * an issuer, clock, revocation log, finality, protocol or scoring permission.
 * Offline metadata only; no network, filesystem, secrets or production paths.
 */
import { createHash, createPublicKey } from "node:crypto";
import { buildForwardV02IndependentProofRequest, snapshotForwardV02UntrustedGraph, snapshotForwardV02UntrustedPolicy } from "./forwardV02IndependentProofRequest";
import { assessForwardV02SyntheticClaimedAnchorBinding } from "./forwardV02SyntheticClaimedAnchorBinding";
import { snapshotForwardV02SyntheticClaim } from "./forwardV02SyntheticEd25519Claim";
import { digestForwardV02UntrustedRequest } from "./forwardV02UntrustedVerifierResponse";

const REFERENCE_KEYS = [
  "schemaVersion", "role", "authorityId", "anchorId",
  "publicKeyDigest", "state", "validFrom", "validUntil",
] as const;
const REFERENCE_VERSION = "forward-v02-synthetic-reference-anchor.0.1-untrusted";
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

export type ForwardV02SyntheticReferenceAssessment = Readonly<{
  signatureMathConsistent: boolean;
  claimedAnchorKeyDigestMatches: boolean;
  referenceCorrelationConsistent: boolean;
  independentAuthorityVerified: false;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

function result(
  math: boolean, claimed: boolean, reference: boolean, blocker: string,
): ForwardV02SyntheticReferenceAssessment {
  return Object.freeze({
    signatureMathConsistent: math,
    claimedAnchorKeyDigestMatches: claimed,
    referenceCorrelationConsistent: reference,
    independentAuthorityVerified: false,
    scoringAuthorized: false,
    blockers: Object.freeze([blocker]),
  });
}

/** Strict own-descriptor snapshot: never execute caller getters or iterators. */
function snapshot(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  try {
    // Pin reference fields before caller-controlled getPrototypeOf/ownKeys
    // Proxy traps. A trap can otherwise repair a revoked or mismatching
    // reference before descriptor capture. This is not an atomic snapshot
    // across separate adversarial inputs.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (let i = 0; i < REFERENCE_KEYS.length; i++) {
      const key = REFERENCE_KEYS[i]!;
      const d = Object.getOwnPropertyDescriptor(input, key);
      if (!d || !d.enumerable || !("value" in d)) return null;
      out[key] = d.value;
    }
    const proto = Object.getPrototypeOf(input);
    // Exact own keys reject an own toJSON; inspect only the known prototype
    // for inherited toJSON without invoking a live has trap.
    if ((proto !== Object.prototype && proto !== null) ||
        (proto !== null && "toJSON" in proto) ||
        Reflect.ownKeys(input).length !== REFERENCE_KEYS.length) return null;
    return out;
  } catch { return null; }
}

function utcSecond(x: unknown): x is string {
  if (typeof x !== "string" || !UTC.test(x) || x.startsWith("0000-")) return false;
  const ms = Date.parse(x);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) + "Z" === x;
}

function claimedKeyDigest(claim: unknown): string | null {
  if (claim === null || typeof claim !== "object") return null;
  try {
    const d = Object.getOwnPropertyDescriptor(claim, "claimedPublicKeySpkiPem");
    if (!d || !d.enumerable || !("value" in d) || typeof d.value !== "string") return null;
    const key = createPublicKey(d.value);
    if (key.asymmetricKeyType !== "ed25519") return null;
    return createHash("sha256")
      .update(key.export({ format: "der", type: "spki" })).digest("hex");
  } catch { return null; }
}

/** Read a signed request binding without invoking caller-controlled accessors. */
function claimedBindingDigest(claim: unknown): string | null {
  if (claim === null || typeof claim !== "object") return null;
  try {
    const d = Object.getOwnPropertyDescriptor(claim, "claimedRequestBindingDigest");
    return d && d.enumerable && "value" in d && typeof d.value === "string"
      ? d.value : null;
  } catch { return null; }
}

/**
 * Deny-only comparison against a separate SYNTHETIC reference fixture.
 * It intentionally accepts no privileged store or trusted reference provider.
 * Passing a second object is not evidence of independent provisioning.
 */
export function assessForwardV02SyntheticReferenceAnchorConflict(
  envelopeInput: unknown, policyInput: unknown, proofRefsInput: unknown,
  claimInput: unknown, roleInput: unknown, referenceInput: unknown,
): ForwardV02SyntheticReferenceAssessment {
  if (roleInput !== "WITNESS" && roleInput !== "SETTLEMENT") {
    return result(false, false, false, "INVALID_REFERENCE_ROLE");
  }
  // Pin the separate caller-owned reference BEFORE signature math and policy
  // correlation. A callback-free descriptor proxy can otherwise mutate the
  // original reference during those phases and make a previously mismatching
  // key/identity appear consistent at the final lookup. Still UNTRUSTED.
  const referenceSnapshot = referenceInput === null || referenceInput === undefined
    ? null : snapshot(referenceInput);
  // Pin policy before the caller claim can run descriptor Proxy traps.
  // Otherwise a claim can repair a mismatching policy anchor before capture.
  // The reference is already pinned above; these graphs are still untrusted
  // and no atomic snapshot across adversarial inputs is claimed.
  const policy = snapshotForwardV02UntrustedPolicy(policyInput);
  if (policy === null) return result(false, false, false, "CLAIMED_ANCHOR_NOT_BOUND");
  // Pin proof refs before the claim Proxy can repair an initially unbound
  // digest. Both nested claimed-anchor math and the final request build must
  // reuse these detached refs, not a later caller-owned revision.
  let refs: unknown;
  try { refs = snapshotForwardV02UntrustedGraph(proofRefsInput); }
  catch { refs = undefined; }
  // A later reference-key lookup must use the same claim snapshot that
  // passed signature math and claimed-anchor correlation, not a mutable proxy.
  const claim = snapshotForwardV02SyntheticClaim(claimInput);
  if (claim === null) return result(false, false, false, "CLAIMED_ANCHOR_NOT_BOUND");
  const claimed = assessForwardV02SyntheticClaimedAnchorBinding(
    envelopeInput, policy, refs, claim, roleInput,
  );
  if (!claimed.signatureMathConsistent || !claimed.claimedAnchorKeyDigestMatches) {
    return result(claimed.signatureMathConsistent, false, false, "CLAIMED_ANCHOR_NOT_BOUND");
  }
  const built = buildForwardV02IndependentProofRequest(
    envelopeInput, policy, refs,
  );
  if (!built.metadataConsistent || built.request === null) {
    return result(true, true, false, "REQUEST_NOT_READY");
  }
  // The claimed signature was checked against an earlier request build.
  // Re-bind this second snapshot: caller-owned proxies may change fields
  // between the mathematical check and this reference comparison.
  if (claimedBindingDigest(claim) !==
      digestForwardV02UntrustedRequest(built.request)) {
    return result(true, true, false, "SYNTHETIC_REFERENCE_REQUEST_CHANGED");
  }
  if (referenceInput === null || referenceInput === undefined) {
    return result(true, true, false, "SYNTHETIC_REFERENCE_MISSING");
  }
  const ref = referenceSnapshot;
  if (!ref || ref.schemaVersion !== REFERENCE_VERSION ||
      (ref.role !== "WITNESS" && ref.role !== "SETTLEMENT") ||
      typeof ref.authorityId !== "string" || !ID.test(ref.authorityId) ||
      typeof ref.anchorId !== "string" || !ID.test(ref.anchorId) ||
      typeof ref.publicKeyDigest !== "string" || !DIGEST.test(ref.publicKeyDigest) ||
      (ref.state !== "ACTIVE" && ref.state !== "REVOKED") ||
      !utcSecond(ref.validFrom) || !utcSecond(ref.validUntil) ||
      Date.parse(ref.validFrom) >= Date.parse(ref.validUntil)) {
    return result(true, true, false, "INVALID_SYNTHETIC_REFERENCE");
  }
  const request = built.request;
  const authority = roleInput === "WITNESS" ? request.freeze.issuerId : request.settlement.sourceId;
  const anchor = roleInput === "WITNESS"
    ? request.freeze.claimedAnchorId : request.settlement.claimedAnchorId;
  if (ref.role !== roleInput || ref.authorityId !== authority || ref.anchorId !== anchor) {
    return result(true, true, false, "SYNTHETIC_REFERENCE_IDENTITY_MISMATCH");
  }
  const digest = claimedKeyDigest(claim);
  if (digest === null || ref.publicKeyDigest !== digest) {
    return result(true, true, false, "SYNTHETIC_REFERENCE_KEY_MISMATCH");
  }
  if (ref.state !== "ACTIVE") {
    return result(true, true, false, "SYNTHETIC_REFERENCE_REVOKED");
  }
  const count = roleInput === "WITNESS" ? 1 : request.settlement.revisions.length;
  for (let i = 0; i < count; i++) {
    // Do not use ambient Array.prototype.map for a validated correction chain.
    const at = roleInput === "WITNESS"
      ? request.freeze.claimedReceiptAt : request.settlement.revisions[i]!.claimedObservedAt;
    const ms = Date.parse(at);
    if (!Number.isFinite(ms) || ms < Date.parse(ref.validFrom) ||
        ms >= Date.parse(ref.validUntil)) {
      return result(true, true, false, "SYNTHETIC_REFERENCE_OUT_OF_WINDOW");
    }
  }
  return result(true, true, true, "SYNTHETIC_REFERENCE_NOT_INDEPENDENT_AUTHORITY");
}
