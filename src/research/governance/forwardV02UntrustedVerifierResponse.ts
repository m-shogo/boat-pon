/**
 * Forward Vault v0.2: quarantine caller-provided "verifier" responses.
 *
 * This is a metadata-only, synthetic, UNTRUSTED response consistency check,
 * NOT a verifier. A matching "VERIFIED" claim is never an independently
 * authenticated witness, settlement result, approved protocol or scoring gate.
 * There are no network calls, trust roots, secrets, raw values or callbacks.
 */
import { buildForwardV02IndependentProofRequest } from "./forwardV02IndependentProofRequest";

export type ForwardV02UntrustedResponseAssessment = Readonly<{
  requestMetadataConsistent: boolean;
  responseMetadataConsistent: boolean;
  independentAuthorityVerified: false;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

const RESPONSE_KEYS = [
  "schemaVersion", "requestSchemaVersion", "policySnapshotDigest",
  "cohortId", "witnessReceiptId", "witnessProofDigest",
  "terminalRevisionId", "settlementProofDigest", "revisionContentDigests",
  "claimedVerifierId", "claimedWitnessStatus", "claimedSettlementStatus",
] as const;
const VERIFIER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const RESPONSE_VERSION = "forward-v02-independent-proof-response.0.1-untrusted";
const REQUEST_VERSION = "forward-v02-independent-proof-request.0.1-untrusted";

/** Read own data descriptors only; never invoke input accessors or iterators. */
function snapshotExact(input: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  try {
    const proto = Object.getPrototypeOf(input);
    if ((proto !== Object.prototype && proto !== null) ||
        "toJSON" in input || Reflect.ownKeys(input).length !== keys.length) return null;
    const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const d = Object.getOwnPropertyDescriptor(input, key);
      if (!d || !d.enumerable || !("value" in d)) return null;
      values[key] = d.value;
    }
    return values;
  } catch { return null; }
}

function snapshotDigests(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  try {
    if (Object.getPrototypeOf(input) !== Array.prototype || "toJSON" in input ||
        Reflect.ownKeys(input).length !== input.length + 1 ||
        input.length < 1 || input.length > 10000) return null;
    const result: string[] = [];
    for (let i = 0; i < input.length; i++) {
      const d = Object.getOwnPropertyDescriptor(input, String(i));
      if (!d || !d.enumerable || !("value" in d) ||
          typeof d.value !== "string" || !DIGEST.test(d.value)) return null;
      result[i] = d.value;
    }
    return result;
  } catch { return null; }
}

function result(
  requestMetadataConsistent: boolean, responseMetadataConsistent: boolean,
  blockers: readonly string[],
): ForwardV02UntrustedResponseAssessment {
  const copy: string[] = [];
  for (let i = 0; i < blockers.length; i++) copy[i] = blockers[i]!;
  return Object.freeze({
    requestMetadataConsistent, responseMetadataConsistent,
    independentAuthorityVerified: false, scoringAuthorized: false,
    blockers: Object.freeze(copy),
  });
}

/**
 * Bind a claimed response to every request revision, not just its terminal ID.
 * A caller-selected verifier name and "VERIFIED" statuses are never authority.
 * Only a separately reviewed, independently provisioned future verifier could
 * authenticate signatures, clock, revocation, source finality and completeness.
 */
export function assessForwardV02UntrustedVerifierResponse(
  envelopeInput: unknown, policyInput: unknown, proofRefsInput: unknown,
  responseInput: unknown,
): ForwardV02UntrustedResponseAssessment {
  const built = buildForwardV02IndependentProofRequest(
    envelopeInput, policyInput, proofRefsInput,
  );
  if (!built.metadataConsistent || built.request === null) {
    return result(false, false, ["REQUEST_NOT_READY"]);
  }
  const r = snapshotExact(responseInput, RESPONSE_KEYS);
  if (!r || r.schemaVersion !== RESPONSE_VERSION ||
      r.requestSchemaVersion !== REQUEST_VERSION ||
      typeof r.claimedVerifierId !== "string" || !VERIFIER_ID.test(r.claimedVerifierId) ||
      (r.claimedWitnessStatus !== "VERIFIED" &&
       r.claimedWitnessStatus !== "REJECTED" &&
       r.claimedWitnessStatus !== "UNKNOWN") ||
      (r.claimedSettlementStatus !== "VERIFIED" &&
       r.claimedSettlementStatus !== "REJECTED" &&
       r.claimedSettlementStatus !== "UNKNOWN")) {
    return result(true, false, ["INVALID_VERIFIER_RESPONSE"]);
  }
  const revisions = snapshotDigests(r.revisionContentDigests);
  if (revisions === null) return result(true, false, ["INVALID_VERIFIER_RESPONSE"]);
  const request = built.request;
  if (r.policySnapshotDigest !== request.policySnapshotDigest ||
      r.cohortId !== request.freeze.cohortId ||
      r.witnessReceiptId !== request.freeze.receiptId ||
      r.witnessProofDigest !== request.freeze.witnessProofDigest ||
      r.terminalRevisionId !== request.settlement.terminalRevisionId ||
      r.settlementProofDigest !== request.settlement.settlementProofDigest ||
      revisions.length !== request.settlement.revisions.length) {
    return result(true, false, ["UNBOUND_VERIFIER_RESPONSE"]);
  }
  for (let i = 0; i < revisions.length; i++) {
    if (revisions[i] !== request.settlement.revisions[i]!.contentDigest) {
      return result(true, false, ["UNBOUND_VERIFIER_RESPONSE"]);
    }
  }
  return result(true, true, [
    "UNTRUSTED_VERIFIER_RESPONSE", "UNVERIFIED_WITNESS",
    "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL",
  ]);
}
