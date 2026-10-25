/**
 * Forward Vault v0.2: quarantine caller-provided "verifier" responses.
 *
 * This is a metadata-only, synthetic, UNTRUSTED response consistency check,
 * NOT a verifier. A matching "VERIFIED" claim is never an independently
 * authenticated witness, settlement result, approved protocol or scoring gate.
 * There are no network calls, trust roots, secrets, raw values or callbacks.
 */
import { createHash } from "node:crypto";
import { buildForwardV02IndependentProofRequest, type ForwardV02IndependentProofRequest } from "./forwardV02IndependentProofRequest";
import { snapshotForwardV02UntrustedGraph } from "./forwardV02UntrustedSnapshot";

export type ForwardV02UntrustedResponseAssessment = Readonly<{
  requestMetadataConsistent: boolean;
  responseMetadataConsistent: boolean;
  independentAuthorityVerified: false;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

const RESPONSE_KEYS = [
  "schemaVersion", "requestSchemaVersion", "requestBindingDigest", "policySnapshotDigest",
  "cohortId", "witnessReceiptId", "witnessProofDigest",
  "terminalRevisionId", "settlementProofDigest", "revisionContentDigests",
  "claimedVerifierId", "claimedWitnessStatus", "claimedSettlementStatus",
] as const;
const VERIFIER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const RESPONSE_VERSION = "forward-v02-independent-proof-response.0.2-untrusted";
const REQUEST_VERSION = "forward-v02-independent-proof-request.0.1-untrusted";

const REQUEST_FIELDS = ["schemaVersion", "policySnapshotDigest", "freeze", "settlement"] as const;
const REQUEST_FREEZE_FIELDS = [
  "cohortId", "protocolDigest", "membershipDigest", "claimedFirstDecisionAt",
  "issuerId", "receiptId", "claimedReceiptAt", "claimedAnchorId", "witnessProofDigest",
] as const;
const REQUEST_SETTLEMENT_FIELDS = [
  "sourceId", "claimedAnchorId", "terminalRevisionId", "settlementProofDigest", "revisions",
] as const;
const REQUEST_SETTLEMENT_SCALARS = [
  "sourceId", "claimedAnchorId", "terminalRevisionId", "settlementProofDigest",
] as const;
const REQUEST_REVISION_FIELDS = [
  "revisionId", "contentDigest", "predecessorDigest", "sequence",
  "claimedObservedAt", "claimedSourceFinality",
] as const;

function exactOwnFields(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length) return false;
  for (let i = 0; i < keys.length; i++) {
    if (!Object.hasOwn(input, keys[i]!)) return false;
  }
  return true;
}

function nonemptyStringFields(input: Record<string, unknown>, keys: readonly string[]): boolean {
  for (let i = 0; i < keys.length; i++) {
    const value = input[keys[i]!];
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}

/**
 * The digest helper is exported, so its TypeScript type alone cannot be a
 * runtime admission boundary. Pin the complete request graph before hashing:
 * no caller-owned get trap or later descriptor repair may change the transcript.
 * This validates only structural metadata, never independent authority.
 */
function pinnedRequestForDigest(input: unknown): ForwardV02IndependentProofRequest {
  let pinned: unknown;
  try { pinned = snapshotForwardV02UntrustedGraph(input); }
  catch { throw new TypeError("INVALID_UNTRUSTED_REQUEST"); }
  if (!exactOwnFields(pinned, REQUEST_FIELDS) ||
      pinned.schemaVersion !== REQUEST_VERSION ||
      typeof pinned.policySnapshotDigest !== "string" ||
      !DIGEST.test(pinned.policySnapshotDigest) ||
      !exactOwnFields(pinned.freeze, REQUEST_FREEZE_FIELDS) ||
      !nonemptyStringFields(pinned.freeze, REQUEST_FREEZE_FIELDS) ||
      !exactOwnFields(pinned.settlement, REQUEST_SETTLEMENT_FIELDS) ||
      !nonemptyStringFields(pinned.settlement, REQUEST_SETTLEMENT_SCALARS)) {
    throw new TypeError("INVALID_UNTRUSTED_REQUEST");
  }
  const revisions = pinned.settlement.revisions;
  if (!Array.isArray(revisions) || revisions.length < 1 || revisions.length > 10000) {
    throw new TypeError("INVALID_UNTRUSTED_REQUEST");
  }
  for (let i = 0; i < revisions.length; i++) {
    const r: unknown = revisions[i];
    if (!exactOwnFields(r, REQUEST_REVISION_FIELDS) ||
        !nonemptyStringFields(r, ["revisionId", "contentDigest", "claimedObservedAt", "claimedSourceFinality"]) ||
        (r.predecessorDigest !== null && typeof r.predecessorDigest !== "string") ||
        !Number.isSafeInteger(r.sequence) || (r.sequence as number) < 1) {
      throw new TypeError("INVALID_UNTRUSTED_REQUEST");
    }
  }
  return pinned as unknown as ForwardV02IndependentProofRequest;
}


/**
 * Deterministic SHA-256 transcript of ALL allowlisted request fields.
 * This is a collision-resistant structural correlation ID, NOT a signature,
 * independent verification, approved trust root, or scoring authorization.
 * Length-prefixed UTF-8 fields avoid delimiter ambiguity and JSON/toJSON hooks.
 * Call only on the immutable request returned by the strict preflight builder.
 */
export function digestForwardV02UntrustedRequest(request: ForwardV02IndependentProofRequest): string {
  const pinned = pinnedRequestForDigest(request);
  const hash = createHash("sha256");
  hash.update("boat-pon.forward-v02.untrusted-request-transcript.v1\\0");
  const add = (value: string): void => {
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update(":");
    hash.update(value, "utf8");
    hash.update(";");
  };
  add(pinned.schemaVersion);
  add(pinned.policySnapshotDigest);
  const f = pinned.freeze;
  add(f.cohortId);
  add(f.protocolDigest);
  add(f.membershipDigest);
  add(f.claimedFirstDecisionAt);
  add(f.issuerId);
  add(f.receiptId);
  add(f.claimedReceiptAt);
  add(f.claimedAnchorId);
  add(f.witnessProofDigest);
  const settlement = pinned.settlement;
  add(settlement.sourceId);
  add(settlement.claimedAnchorId);
  add(settlement.terminalRevisionId);
  add(settlement.settlementProofDigest);
  add(String(settlement.revisions.length));
  for (let i = 0; i < settlement.revisions.length; i++) {
    const r = settlement.revisions[i]!;
    add(r.revisionId);
    add(r.contentDigest);
    add(r.predecessorDigest === null ? "NULL" : "VALUE");
    if (r.predecessorDigest !== null) add(r.predecessorDigest);
    add(String(r.sequence));
    add(r.claimedObservedAt);
    add(r.claimedSourceFinality);
  }
  return hash.digest("hex");
}

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
  // Pin the entire caller-owned response before request preflight. An
  // envelope/policy/refs descriptor proxy can otherwise replace a mismatching
  // response field during the builder and launder a later claim into a match.
  // Revision digests are a nested caller-owned array and must be pinned here
  // too, not after the request is built. Both remain untrusted metadata.
  const r = snapshotExact(responseInput, RESPONSE_KEYS);
  const revisions = r ? snapshotDigests(r.revisionContentDigests) : null;
  const built = buildForwardV02IndependentProofRequest(
    envelopeInput, policyInput, proofRefsInput,
  );
  if (!built.metadataConsistent || built.request === null) {
    return result(false, false, ["REQUEST_NOT_READY"]);
  }
  if (!r || r.schemaVersion !== RESPONSE_VERSION ||
      r.requestSchemaVersion !== REQUEST_VERSION ||
      typeof r.requestBindingDigest !== "string" || !DIGEST.test(r.requestBindingDigest) ||
      typeof r.claimedVerifierId !== "string" || !VERIFIER_ID.test(r.claimedVerifierId) ||
      (r.claimedWitnessStatus !== "VERIFIED" &&
       r.claimedWitnessStatus !== "REJECTED" &&
       r.claimedWitnessStatus !== "UNKNOWN") ||
      (r.claimedSettlementStatus !== "VERIFIED" &&
       r.claimedSettlementStatus !== "REJECTED" &&
       r.claimedSettlementStatus !== "UNKNOWN")) {
    return result(true, false, ["INVALID_VERIFIER_RESPONSE"]);
  }
  if (revisions === null) return result(true, false, ["INVALID_VERIFIER_RESPONSE"]);
  const request = built.request;
  if (r.requestBindingDigest !== digestForwardV02UntrustedRequest(request) ||
      r.policySnapshotDigest !== request.policySnapshotDigest ||
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
