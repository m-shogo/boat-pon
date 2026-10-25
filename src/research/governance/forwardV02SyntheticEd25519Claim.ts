/**
 * Offline, synthetic Ed25519 *mathematics* probe for Forward Vault v0.2.
 *
 * All material (including the public key) is caller supplied. Even a valid
 * signature proves only that the matching private key signed the request
 * transcript: it does NOT establish an independent trust root, source
 * authenticity, trusted clock, settlement finality, protocol approval or
 * scoring authority. Never use this probe for production or admission.
 *
 * No network, filesystem, key store, secrets, odds or external callbacks.
 */
import { createPublicKey, verify } from "node:crypto";
import { buildForwardV02IndependentProofRequest, snapshotForwardV02UntrustedGraph } from "./forwardV02IndependentProofRequest";
import { digestForwardV02UntrustedRequest } from "./forwardV02UntrustedVerifierResponse";

const CLAIM_VERSION = "forward-v02-synthetic-ed25519-claim.0.1-untrusted";
const CLAIM_KEYS = [
  "schemaVersion", "claimedSignerId", "claimedPublicKeySpkiPem",
  "claimedRequestBindingDigest", "claimedSignatureHex",
] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const SIGNATURE = /^[0-9a-f]{128}$/u;

export type ForwardV02SyntheticSignatureAssessment = Readonly<{
  requestMetadataConsistent: boolean;
  signatureMathConsistent: boolean;
  independentAuthorityVerified: false;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

function assessment(
  requestMetadataConsistent: boolean, signatureMathConsistent: boolean,
  blocker: string,
): ForwardV02SyntheticSignatureAssessment {
  return Object.freeze({
    requestMetadataConsistent,
    signatureMathConsistent,
    independentAuthorityVerified: false,
    scoringAuthorized: false,
    blockers: Object.freeze([blocker]),
  });
}

/** Only own enumerable data properties; do not invoke input getters/iterators. */
export function snapshotForwardV02SyntheticClaim(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  try {
    // Capture expected own data descriptors before caller-controlled
    // getPrototypeOf/ownKeys Proxy traps. Those traps can repair a bad
    // signature before a later descriptor read; validation must use only
    // the pre-trap copy. This is not an atomic multi-Proxy snapshot.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (let i = 0; i < CLAIM_KEYS.length; i++) {
      const key = CLAIM_KEYS[i]!;
      const d = Object.getOwnPropertyDescriptor(input, key);
      if (!d || !d.enumerable || !("value" in d)) return null;
      out[key] = d.value;
    }
    const proto = Object.getPrototypeOf(input);
    // Exact own keys reject an own toJSON; inspect only the known built-in
    // prototype for inherited toJSON without invoking a live has trap.
    if ((proto !== Object.prototype && proto !== null) ||
        (proto !== null && "toJSON" in proto) ||
        Reflect.ownKeys(input).length !== CLAIM_KEYS.length) return null;
    return out;
  } catch { return null; }
}

/**
 * Checks a synthetic caller-provided Ed25519 signature against the complete
 * domain-separated untrusted request digest. It intentionally accepts no
 * independently provisioned trust anchors and NEVER returns authority.
 */
export function assessForwardV02SyntheticEd25519Claim(
  envelopeInput: unknown, policyInput: unknown, proofRefsInput: unknown,
  claimInput: unknown,
): ForwardV02SyntheticSignatureAssessment {
  // Pin policy and proof refs before traversing the claim: a claim Proxy
  // can otherwise repair a revoked anchor or mismatched proof ref before
  // the request builder captures those inputs. Pin the claim before the
  // envelope is traversed, preserving the earlier signature-swap guardrail.
  // This is a deny-only structural ordering, not an atomic multi-input read.
  let policy: unknown, refs: unknown;
  try { policy = snapshotForwardV02UntrustedGraph(policyInput); }
  catch { policy = undefined; }
  try { refs = snapshotForwardV02UntrustedGraph(proofRefsInput); }
  catch { refs = undefined; }
  const c = snapshotForwardV02SyntheticClaim(claimInput);
  const built = buildForwardV02IndependentProofRequest(
    envelopeInput, policy, refs,
  );
  if (!built.metadataConsistent || built.request === null) {
    return assessment(false, false, "REQUEST_NOT_READY");
  }
  if (!c || c.schemaVersion !== CLAIM_VERSION ||
      typeof c.claimedSignerId !== "string" || !ID.test(c.claimedSignerId) ||
      typeof c.claimedPublicKeySpkiPem !== "string" ||
      c.claimedPublicKeySpkiPem.length < 80 ||
      c.claimedPublicKeySpkiPem.length > 512 ||
      typeof c.claimedRequestBindingDigest !== "string" ||
      !DIGEST.test(c.claimedRequestBindingDigest) ||
      typeof c.claimedSignatureHex !== "string" ||
      !SIGNATURE.test(c.claimedSignatureHex)) {
    return assessment(true, false, "INVALID_SIGNATURE_CLAIM");
  }
  const expected = digestForwardV02UntrustedRequest(built.request);
  if (c.claimedRequestBindingDigest !== expected) {
    return assessment(true, false, "UNBOUND_SIGNATURE_CLAIM");
  }
  try {
    const key = createPublicKey(c.claimedPublicKeySpkiPem);
    if (key.asymmetricKeyType !== "ed25519") {
      return assessment(true, false, "UNSUPPORTED_SIGNATURE_KEY");
    }
    const valid = verify(
      null, Buffer.from(expected, "hex"), key,
      Buffer.from(c.claimedSignatureHex, "hex"),
    );
    if (!valid) return assessment(true, false, "SIGNATURE_MISMATCH");
    return assessment(true, true, "CALLER_SUPPLIED_KEY_NOT_AUTHORITY");
  } catch {
    return assessment(true, false, "INVALID_SIGNATURE_CLAIM");
  }
}
