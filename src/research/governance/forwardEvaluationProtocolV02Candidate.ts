import { snapshotForwardV02UntrustedGraph } from "./forwardV02IndependentProofRequest";

/**
 * Unapproved, research-only Forward Vault v0.2 protocol design preflight.
 *
 * This checks whether a proposed contract explicitly specifies the dimensions
 * missing from v0.1. It does NOT authenticate a source manifest, prove a
 * prospective freeze, compute ROI, or grant scoring/production authority.
 * Existing v0.1 records and digests remain untouched.
 */
export const FORWARD_V02_CANDIDATE_VERSION = "forward-evaluation-protocol.0.2-candidate" as const;

export type ForwardV02CandidateAssessment = Readonly<{
  candidateComplete: boolean;
  scoringAuthorized: false;
  blockers: readonly string[];
}>;

const TOP = [
  "schemaVersion", "kind", "protocolId", "protocolVersion", "status",
  "evidenceStage", "createdAt", "comparisonMode", "oddsBasis",
  "metricFormulaId", "metricFormulaDigest", "moneyPolicy", "maxHitPolicy",
  "samplePolicy", "exclusionReasons", "benchmarkDecisionSystems",
  "evidenceRequirements", "productionConnection", "scoringAuthorized",
] as const;
const MONEY = [
  "currency", "unit", "netRoiFormula", "stakePopulation", "returnPopulation",
  "specialPayout", "refund", "void", "cancelled",
  "unresolved", "zeroDenominator",
] as const;
const MAX_HIT = [
  "eventUnit", "exclusionAlignment", "tieBreak", "noPositiveEvent",
  "stakeAndPayoutRemoval",
] as const;
const SAMPLE = ["minDecisions", "minRaces", "grouping"] as const;
const EVIDENCE = ["outcome", "sourceManifest", "enrollment", "stagePooling"] as const;
const EXCLUSIONS = [
  "REFUNDED", "VOID", "CANCELLED", "UNRESOLVED", "NONFINAL",
  "NOT_EVALUABLE", "IDENTITY_MISMATCH", "NOT_ENROLLED", "SPECIAL_PAYOUT",
] as const;
const SHA256 = /^[0-9a-f]{64}$/u;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    return (proto === Object.prototype || proto === null) && !("toJSON" in value);
  } catch { return false; }
}

// Inspect descriptors instead of invoking accessors; reject unknown, symbol,
// non-enumerable, or inherited fields before inspecting any candidate values.
function exactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!plainObject(value)) return false;
  try {
    if (Reflect.ownKeys(value).length !== fields.length) return false;
    for (let i = 0; i < fields.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, fields[i]!);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
    }
    return true;
  } catch { return false; }
}

function stringArray(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || "toJSON" in value ||
        Reflect.ownKeys(value).length !== value.length + 1) return false;
    const seen = new Set<string>();
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) ||
          typeof descriptor.value !== "string" || !descriptor.value.trim() ||
          seen.has(descriptor.value)) return false;
      seen.add(descriptor.value);
    }
    return true;
  } catch { return false; }
}

function exactInstant(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(value);
  if (!match || value.endsWith("-00:00")) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  if (year === 0 || month < 1 || month > 12 || hour > 23 || minute > 59 ||
      second > 59 || offsetHour > 23 || offsetMinute > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1]! && Number.isFinite(Date.parse(value));
}

function validStage(value: unknown): boolean {
  return value === "HISTORICAL" || value === "VALIDATION" ||
    value === "UNTOUCHED_HOLDOUT" || value === "SHADOW_FORWARD" ||
    value === "FUTURE_ONLY";
}

function hasOwnArrayEntry(values: readonly string[], expected: string): boolean {
  for (let i = 0; i < values.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(i));
    if (descriptor && descriptor.enumerable && "value" in descriptor &&
        descriptor.value === expected) return true;
  }
  return false;
}

const deny = (blockers: string[]): ForwardV02CandidateAssessment =>
  Object.freeze({ candidateComplete: false, scoringAuthorized: false, blockers: Object.freeze(blockers) });

/**
 * Only validates a CANDIDATE contract's explicitness and internal coherence.
 * There is intentionally no authorized return path, including on success.
 */
export function assessForwardV02Candidate(input: unknown): ForwardV02CandidateAssessment {
  // Standalone candidate validation is also an untrusted entry point. Pin the
  // complete descriptor graph before any semantic reads; a late Proxy trap
  // must not repair a previously copied invalid policy or evidence stage.
  try {
    input = snapshotForwardV02UntrustedGraph(input);
    if (!exactObject(input, TOP)) return deny(["INVALID_CANDIDATE_SHAPE"]);
    const c = input;
    if (c.schemaVersion !== FORWARD_V02_CANDIDATE_VERSION ||
        c.kind !== "EVALUATION_PROTOCOL" || c.protocolVersion !== "0.2-candidate" ||
        c.status !== "UNAPPROVED" || typeof c.protocolId !== "string" || !c.protocolId.trim() ||
        !exactInstant(c.createdAt) ||
        !validStage(c.evidenceStage) ||
        (c.comparisonMode !== "SELECTED_RACE" && c.comparisonMode !== "COMMON_COHORT") ||
        (c.oddsBasis !== "BUY_TIME" && c.oddsBasis !== "CLOSING" && c.oddsBasis !== "NONE") ||
        c.metricFormulaId !== "NET_ROI_ON_STAKE_V1" ||
        typeof c.metricFormulaDigest !== "string" || !SHA256.test(c.metricFormulaDigest) ||
        c.productionConnection !== false || c.scoringAuthorized !== false) {
      return deny(["INVALID_CANDIDATE_HEADER"]);
    }

    if (!exactObject(c.moneyPolicy, MONEY) ||
        c.moneyPolicy.currency !== "JPY" || c.moneyPolicy.unit !== "INTEGER_YEN" ||
        c.moneyPolicy.netRoiFormula !== "(SUM_PAYOUT_MINUS_SUM_STAKE)/SUM_STAKE" ||
        // Consumer return-rate includes refunds and special payouts. A draft
        // research ROI must declare a different, evaluable-only population.
        c.moneyPolicy.stakePopulation !== "EVALUABLE_SETTLED_STAKE_ONLY" ||
        c.moneyPolicy.returnPopulation !== "EVALUABLE_SETTLED_PAYOUT_ONLY" ||
        c.moneyPolicy.specialPayout !== "EXCLUDE_AND_COUNT" ||
        c.moneyPolicy.refund !== "EXCLUDE_AND_COUNT" ||
        c.moneyPolicy.void !== "EXCLUDE_AND_COUNT" ||
        c.moneyPolicy.cancelled !== "EXCLUDE_AND_COUNT" ||
        c.moneyPolicy.unresolved !== "EXCLUDE_AND_COUNT" ||
        c.moneyPolicy.zeroDenominator !== "UNSCORABLE_AND_REPORT") {
      return deny(["UNFROZEN_MONEY_OR_OUTCOME_POLICY"]);
    }

    if (!exactObject(c.maxHitPolicy, MAX_HIT) ||
        (c.maxHitPolicy.eventUnit !== "DECISION_RECORD" && c.maxHitPolicy.eventUnit !== "CANONICAL_RACE") ||
        (c.maxHitPolicy.exclusionAlignment !== "SYSTEM_SPECIFIC_SENSITIVITY_ONLY" &&
         c.maxHitPolicy.exclusionAlignment !== "SHARED_PREDECLARED_RACE") ||
        c.maxHitPolicy.tieBreak !== "LEXICOGRAPHIC_EVENT_ID_ASC" ||
        c.maxHitPolicy.noPositiveEvent !== "REMOVE_NONE" ||
        c.maxHitPolicy.stakeAndPayoutRemoval !== "REMOVE_BOTH") {
      return deny(["UNFROZEN_MAX_HIT_POLICY"]);
    }
    if (c.maxHitPolicy.exclusionAlignment === "SHARED_PREDECLARED_RACE" &&
        c.maxHitPolicy.eventUnit !== "CANONICAL_RACE") {
      return deny(["INCONSISTENT_EXCLUSION_UNIT"]);
    }
    if (c.comparisonMode === "COMMON_COHORT" &&
        c.maxHitPolicy.exclusionAlignment !== "SHARED_PREDECLARED_RACE") {
      return deny(["COMMON_COHORT_EXCLUSION_MISALIGNMENT"]);
    }

    if (!exactObject(c.samplePolicy, SAMPLE) ||
        !Number.isSafeInteger(c.samplePolicy.minDecisions) || (c.samplePolicy.minDecisions as number) < 1 ||
        !Number.isSafeInteger(c.samplePolicy.minRaces) || (c.samplePolicy.minRaces as number) < 1 ||
        c.samplePolicy.grouping !== "PER_STAGE_PER_DECISION_SYSTEM") {
      return deny(["UNFROZEN_SAMPLE_POLICY"]);
    }
    if (!stringArray(c.exclusionReasons) || c.exclusionReasons.length !== EXCLUSIONS.length) {
      return deny(["INCOMPLETE_EXCLUSION_TAXONOMY"]);
    }
    for (let i = 0; i < EXCLUSIONS.length; i++) {
      if (!hasOwnArrayEntry(c.exclusionReasons, EXCLUSIONS[i]!)) return deny(["INCOMPLETE_EXCLUSION_TAXONOMY"]);
    }
    if (!stringArray(c.benchmarkDecisionSystems)) return deny(["INVALID_BENCHMARK_SET"]);

    if (!exactObject(c.evidenceRequirements, EVIDENCE) ||
        c.evidenceRequirements.outcome !== "INDEPENDENT_EXACT_FINAL_EVALUABLE_SETTLED" ||
        c.evidenceRequirements.sourceManifest !== "INDEPENDENT_DIGEST_RECONCILIATION" ||
        c.evidenceRequirements.enrollment !== "PROSPECTIVE_FROZEN_BEFORE_DECISION" ||
        c.evidenceRequirements.stagePooling !== "PROHIBITED") {
      return deny(["MISSING_INDEPENDENT_EVIDENCE_REQUIREMENTS"]);
    }
    return Object.freeze({
      candidateComplete: true,
      scoringAuthorized: false,
      blockers: Object.freeze(["UNAPPROVED_PROTOCOL", "INDEPENDENT_EVIDENCE_NOT_VERIFIED"]),
    });
  } catch {
    return deny(["INVALID_CANDIDATE_SHAPE"]);
  }
}
