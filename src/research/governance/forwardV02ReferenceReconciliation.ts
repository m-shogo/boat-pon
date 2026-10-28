import { createHash } from "node:crypto";
import { snapshotForwardV02UntrustedGraphRejectingProxies } from "./forwardV02UntrustedSnapshot";
import { assessForwardV02Candidate } from "./forwardEvaluationProtocolV02Candidate";
import { snapshotForwardV02UntrustedGraph } from "./forwardV02IndependentProofRequest";

/**
 * Research-only content-address reconciliation of UNTRUSTED reference
 * artifacts. Matching digests do not authenticate an external authority.
 * Never computes ROI, scores evidence, or grants production authority.
 */
export type ForwardV02ReferenceAssessment = Readonly<{
  referencesReconciled: boolean;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

const SHA = /^[0-9a-f]{64}$/u;
const FORMULA_KEYS = ["formulaId", "expression", "currency", "unit", "denominator"] as const;
const MANIFEST_KEYS = [
  "schemaVersion", "manifestId", "evidenceStage", "analysisSnapshotDigest",
  "decisionDigests", "outcomeDigests", "createdAt", "productionConnection",
] as const;
const REFS_KEYS = [
  "formula", "formulaDigest", "sourceManifest", "expectedSourceManifestDigest",
  "resultSourceManifestDigest", "expectedAnalysisSnapshotDigest",
] as const;

function exactDataObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    if ((proto !== Object.prototype && proto !== null) || "toJSON" in value) return false;
    if (Reflect.ownKeys(value).length !== keys.length) return false;
    for (let i = 0; i < keys.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, keys[i]!);
      if (!d || !d.enumerable || !("value" in d)) return false;
    }
    return true;
  } catch { return false; }
}

function digestList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || "toJSON" in value ||
        Reflect.ownKeys(value).length !== value.length + 1) return false;
    const seen = new Set<string>();
    for (let i = 0; i < value.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d || !d.enumerable || !("value" in d) ||
          typeof d.value !== "string" || !SHA.test(d.value) || seen.has(d.value)) return false;
      seen.add(d.value);
    }
    return true;
  } catch { return false; }
}

function exactInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(value);
  if (!m || value.endsWith("-00:00")) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const hour = Number(m[4]), minute = Number(m[5]), second = Number(m[6]);
  if (year === 0 || month < 1 || month > 12 || hour > 23 || minute > 59 ||
      second > 59 || Number(m[7] ?? 0) > 23 || Number(m[8] ?? 0) > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1]! && Number.isFinite(Date.parse(value));
}

// Node's UTF-8 encoder replaces an unpaired UTF-16 surrogate with U+FFFD.
// A manifest identifier must be a well-formed string before it participates in
// a content-addressed reference; otherwise distinct IDs can share a digest.
function wellFormedUtf16(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function contentHash(domain: string, fields: readonly string[]): string {
  const h = createHash("sha256");
  const feed = (value: string): void => {
    h.update(String(Buffer.byteLength(value, "utf8")));
    h.update(":");
    h.update(value);
  };
  feed(domain);
  for (let i = 0; i < fields.length; i++) feed(fields[i]!);
  return h.digest("hex");
}

/** Domain-separated, length-prefixed content hash; NOT formula approval. */
export function forwardV02FormulaReferenceDigest(value: unknown): string | null {
  // This exported digest is also callable without reconciliation. Pin its
  // caller-owned descriptor graph before validation or hashing: shape checks
  // alone cannot prevent a later Proxy trap from repairing an earlier field.
  try { value = snapshotForwardV02UntrustedGraph(value); }
  catch { return null; }
  if (!exactDataObject(value, FORMULA_KEYS)) return null;
  if (value.formulaId !== "NET_ROI_ON_STAKE_V1" ||
      value.expression !== "(SUM_PAYOUT_MINUS_SUM_STAKE)/SUM_STAKE" ||
      value.currency !== "JPY" || value.unit !== "INTEGER_YEN" ||
      value.denominator !== "SUM_STAKE") return null;
  return contentHash("forward-v02-formula-reference-v1", [
    value.formulaId, value.expression, value.currency, value.unit, value.denominator,
  ] as string[]);
}

/** Metadata only: never embed private odds, source bytes, or filesystem paths. */
export function forwardV02SourceManifestReferenceDigest(value: unknown): string | null {
  // Standalone callers receive the same detached, bounded reference semantics
  // as the reconciler. A digest never authenticates the claimed source.
  try { value = snapshotForwardV02UntrustedGraph(value); }
  catch { return null; }
  if (!exactDataObject(value, MANIFEST_KEYS)) return null;
  if (value.schemaVersion !== "forward-source-manifest.0.2-candidate" ||
      typeof value.manifestId !== "string" || !value.manifestId.trim() ||
      !wellFormedUtf16(value.manifestId) ||
      (value.evidenceStage !== "HISTORICAL" && value.evidenceStage !== "VALIDATION" &&
       value.evidenceStage !== "UNTOUCHED_HOLDOUT" && value.evidenceStage !== "SHADOW_FORWARD" &&
       value.evidenceStage !== "FUTURE_ONLY") ||
      typeof value.analysisSnapshotDigest !== "string" || !SHA.test(value.analysisSnapshotDigest) ||
      !exactInstant(value.createdAt) || value.productionConnection !== false ||
      !digestList(value.decisionDigests) || !digestList(value.outcomeDigests)) return null;
  const decisions = value.decisionDigests, outcomes = value.outcomeDigests;
  const fields: string[] = [
    value.schemaVersion, value.manifestId, value.evidenceStage,
    value.analysisSnapshotDigest, value.createdAt, "false", String(decisions.length),
  ];
  // An inherited Array.prototype numeric setter can discard an appended
  // digest and alias two distinct manifests. Define every appended index as
  // an own data property before the content-addressed hash consumes it.
  const appendField = (field: string): void => {
    Object.defineProperty(fields, String(fields.length), {
      value: field, enumerable: true, writable: true, configurable: true,
    });
  };
  for (let i = 0; i < decisions.length; i++) appendField(decisions[i]!);
  appendField(String(outcomes.length));
  for (let i = 0; i < outcomes.length; i++) appendField(outcomes[i]!);
  return contentHash("forward-v02-source-manifest-reference-v1", fields);
}

const blocked = (reason: string): ForwardV02ReferenceAssessment => Object.freeze({
  referencesReconciled: false, scoringAuthorized: false, blockers: Object.freeze([reason]),
});

/** Reference equality only. Caller-supplied matching hashes are never proof of independent origin. */
export function assessForwardV02ReferenceReconciliation(
  candidate: unknown, references: unknown,
): ForwardV02ReferenceAssessment {
  // Pin both caller-owned graphs before any semantic preflight. Strict shape
  // validation alone does not stop later descriptor reads from changing an
  // earlier candidate digest or manifest field. These are still UNTRUSTED
  // references: matching content never authenticates an independent source.
  let pinnedCandidate: unknown, pinnedReferences: unknown;
  try { pinnedCandidate = snapshotForwardV02UntrustedGraph(candidate); }
  catch { return blocked("INVALID_V02_CANDIDATE"); }
  try { pinnedReferences = snapshotForwardV02UntrustedGraph(references); }
  catch { return blocked("INVALID_REFERENCE_SHAPE"); }
  try {
    if (!assessForwardV02Candidate(pinnedCandidate).candidateComplete) return blocked("INVALID_V02_CANDIDATE");
    if (!exactDataObject(pinnedReferences, REFS_KEYS)) return blocked("INVALID_REFERENCE_SHAPE");
    const c = pinnedCandidate as Record<string, unknown>, r = pinnedReferences;
    const formulaHash = forwardV02FormulaReferenceDigest(r.formula);
    if (formulaHash === null || typeof r.formulaDigest !== "string" ||
        r.formulaDigest !== formulaHash || c.metricFormulaDigest !== formulaHash) {
      return blocked("FORMULA_REFERENCE_MISMATCH");
    }
    const manifestHash = forwardV02SourceManifestReferenceDigest(r.sourceManifest);
    if (manifestHash === null || typeof r.expectedSourceManifestDigest !== "string" ||
        typeof r.resultSourceManifestDigest !== "string" ||
        manifestHash !== r.expectedSourceManifestDigest || manifestHash !== r.resultSourceManifestDigest) {
      return blocked("SOURCE_MANIFEST_REFERENCE_MISMATCH");
    }
    const m = r.sourceManifest as Record<string, unknown>;
    if (m.evidenceStage !== c.evidenceStage ||
        typeof r.expectedAnalysisSnapshotDigest !== "string" ||
        !SHA.test(r.expectedAnalysisSnapshotDigest) ||
        m.analysisSnapshotDigest !== r.expectedAnalysisSnapshotDigest) {
      return blocked("STAGE_OR_SNAPSHOT_REFERENCE_MISMATCH");
    }
    return Object.freeze({
      referencesReconciled: true, scoringAuthorized: false,
      blockers: Object.freeze(["UNAPPROVED_PROTOCOL", "INDEPENDENT_AUTHORITY_NOT_ATTESTED", "SETTLEMENT_AND_ENROLLMENT_NOT_VERIFIED"]),
    });
  } catch { return blocked("INVALID_REFERENCE_SHAPE"); }
}

/**
 * Opt-in Node-only ingress for two caller-owned reference graphs.
 * Rejects root/nested/revoked Proxies and accessors before their traps,
 * then delegates to the unchanged, deny-only reference reconciler.
 * Input capture is not atomic against external concurrent writers and
 * matching references never authenticate an independent authority.
 */
export function assessForwardV02ReferenceReconciliationStrictNodeIngress(
  candidate: unknown, references: unknown,
): ForwardV02ReferenceAssessment {
  let pinnedCandidate: unknown, pinnedReferences: unknown;
  try { pinnedCandidate = snapshotForwardV02UntrustedGraphRejectingProxies(candidate); }
  catch { return blocked("INVALID_V02_CANDIDATE"); }
  try { pinnedReferences = snapshotForwardV02UntrustedGraphRejectingProxies(references); }
  catch { return blocked("INVALID_REFERENCE_SHAPE"); }
  return assessForwardV02ReferenceReconciliation(pinnedCandidate, pinnedReferences);
}
