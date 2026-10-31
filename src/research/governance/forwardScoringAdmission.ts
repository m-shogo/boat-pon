/**
 * Research-only K3 scoring-admission preflight.
 *
 * A v0.1 Forward Vault RESULT is an append-only research artifact, not proof
 * that a prospectively frozen scoring protocol and independent settlement
 * manifest exist. This API deliberately has no ALLOW branch. Do not use it
 * to activate an evaluator, production BUY, LINE, publishing, or N2.
 *
 * Future v0.2 work must provide independently verified protocol/formula,
 * manifest, reconciliation and exclusion evidence before an ALLOW type exists.
 */
import {
  forwardVaultDigest,
  resultMatchesProtocol,
  validateForwardVaultRecord,
  type EnrollmentProtocol,
  type Membership,
  type AnalysisSnapshot,
  type EvaluationProtocol,
  type EvaluationResult,
  type EvidenceStage,
} from "./forwardEvaluationVault";
import {
  runtimeDecisionLedgerDigest,
  validateRuntimeDecisionLedgerRecord,
  type RuntimeDecisionLedgerRecord,
} from "./runtimeDecisionLedger";
import {
  validateOutcomeLearningLedgerRecord,
  type OutcomeLearningLedgerRecord,
  type OutcomeReconciliationState,
} from "./outcomeLearningLedger";

export type ForwardScoringDenial =
  | "DENY_INVALID_EVIDENCE"
  | "DENY_RECONCILIATION"
  | "DENY_NONFINAL"
  | "DENY_NOT_EVALUABLE"
  | "DENY_IDENTITY_OR_DIGEST"
  | "DENY_STAGE"
  | "DENY_CHRONOLOGY"
  | "DENY_UNFROZEN_SCORING_CONTRACT";

export type ForwardScoringPreflight = Readonly<{
  scoringAuthorized: false;
  reason: ForwardScoringDenial;
}>;

export type ForwardScoringEvidence = Readonly<{
  enrollment: EnrollmentProtocol;
  membership: Membership;
  snapshot: AnalysisSnapshot;
  protocol: EvaluationProtocol;
  result: EvaluationResult;
  decision: RuntimeDecisionLedgerRecord;
  outcome: OutcomeLearningLedgerRecord;
  /** Caller-reported state is diagnostic only; it does not prove independence. */
  reconciliation: OutcomeReconciliationState;
}>;

const DENY = (reason: ForwardScoringDenial): ForwardScoringPreflight => Object.freeze({
  scoringAuthorized: false,
  reason,
});

// Both inputs have already passed their canonical ledger timestamp validators.
// Compare sub-millisecond fractions without Date.parse millisecond truncation.
function compareExactInstants(a: string, b: string): number {
  const fraction = /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/u;
  const whole = (s: string) => Date.parse(s.replace(fraction, ""));
  const left = whole(a);
  const right = whole(b);
  if (left !== right) return left < right ? -1 : 1;
  const af = fraction.exec(a)?.[1] ?? "";
  const bf = fraction.exec(b)?.[1] ?? "";
  const width = Math.max(af.length, bf.length);
  const aa = af.padEnd(width, "0");
  const bb = bf.padEnd(width, "0");
  return aa < bb ? -1 : aa > bb ? 1 : 0;
}

// Avoid delegating identity checks to mutable Array.prototype methods.
// Canonical validators already require dense arrays; inspect own data entries.
function hasExactEntry(values: readonly string[], expected: string): boolean {
  try {
    for (let index = 0; index < values.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
      if (descriptor && descriptor.enumerable && "value" in descriptor && descriptor.value === expected) return true;
    }
  } catch { return false; }
  return false;
}

function decisionModeMatchesStage(mode: string, stage: EvidenceStage): boolean {
  switch (stage) {
    case "SHADOW_FORWARD": return mode === "shadow_forward";
    case "HISTORICAL": return mode === "historical";
    case "VALIDATION": return mode === "validation";
    case "FUTURE_ONLY": return mode === "future_only";
    // No canonical 0.1 mapping proves untouched-holdout admission.
    case "UNTOUCHED_HOLDOUT": return false;
  }
}

export function assessForwardScoringAdmission(input: unknown): ForwardScoringPreflight {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return DENY("DENY_INVALID_EVIDENCE");
    const evidence = input as ForwardScoringEvidence;
    const { enrollment, membership, snapshot, protocol, result, decision, outcome, reconciliation } = evidence;
    if (!validateForwardVaultRecord(enrollment).valid || enrollment.kind !== "ENROLLMENT_PROTOCOL" ||
        !validateForwardVaultRecord(membership).valid || membership.kind !== "MEMBERSHIP" ||
        !validateForwardVaultRecord(snapshot).valid || snapshot.kind !== "ANALYSIS_SNAPSHOT" ||
        !validateForwardVaultRecord(protocol).valid || protocol.kind !== "EVALUATION_PROTOCOL" ||
        !validateForwardVaultRecord(result).valid || result.kind !== "RESULT" ||
        !validateRuntimeDecisionLedgerRecord(decision).valid ||
        !validateOutcomeLearningLedgerRecord(outcome).valid) {
      return DENY("DENY_INVALID_EVIDENCE");
    }
    if (reconciliation !== "EXACT") return DENY("DENY_RECONCILIATION");
    if (outcome.finality !== "FINAL") return DENY("DENY_NONFINAL");
    if (!outcome.evaluable || outcome.disposition !== "SETTLED") return DENY("DENY_NOT_EVALUABLE");

    if (enrollment.evidenceStage !== membership.evidenceStage ||
        membership.evidenceStage !== snapshot.evidenceStage ||
        snapshot.evidenceStage !== protocol.evidenceStage ||
        protocol.evidenceStage !== result.evidenceStage ||
        !decisionModeMatchesStage(decision.evaluationMode, membership.evidenceStage)) {
      return DENY("DENY_STAGE");
    }

    if (enrollment.decisionSystem !== decision.decisionSystem ||
        !hasExactEntry(enrollment.ticketUniverse, decision.ticketType) ||
        membership.enrollmentProtocolId !== enrollment.enrollmentProtocolId ||
        membership.enrollmentProtocolDigest !== forwardVaultDigest(enrollment) ||
        membership.decisionRecordId !== decision.recordId ||
        membership.decisionRecordDigest !== runtimeDecisionLedgerDigest(decision) ||
        membership.canonicalRaceId !== decision.canonicalRaceId ||
        membership.cohortId !== decision.cohortId || !membership.included ||
        outcome.decisionRecordId !== decision.recordId ||
        outcome.decisionId !== decision.decisionId ||
        outcome.canonicalRaceId !== decision.canonicalRaceId ||
        outcome.ticketType !== decision.ticketType ||
        outcome.selection !== decision.selection ||
        snapshot.cohortId !== membership.cohortId ||
        !hasExactEntry(snapshot.membershipDigests, forwardVaultDigest(membership)) ||
        result.analysisSnapshotId !== snapshot.analysisSnapshotId ||
        result.analysisSnapshotDigest !== forwardVaultDigest(snapshot) ||
        !resultMatchesProtocol(result, protocol) ||
        result.decisionSystem !== decision.decisionSystem) {
      return DENY("DENY_IDENTITY_OR_DIGEST");
    }

    if (compareExactInstants(enrollment.createdAt, decision.decisionAt) >= 0 ||
        compareExactInstants(protocol.createdAt, decision.decisionAt) >= 0 ||
        compareExactInstants(enrollment.createdAt, enrollment.startAt) > 0 ||
        compareExactInstants(enrollment.startAt, decision.decisionAt) > 0 ||
        (enrollment.endAt !== null && compareExactInstants(decision.decisionAt, enrollment.endAt) > 0) ||
        compareExactInstants(enrollment.createdAt, membership.enrolledAt) > 0 ||
        compareExactInstants(enrollment.createdAt, membership.createdAt) > 0 ||
        compareExactInstants(membership.createdAt, decision.decisionAt) > 0 ||
        compareExactInstants(membership.enrolledAt, decision.decisionAt) > 0 ||
        compareExactInstants(decision.decisionAt, outcome.settledAt) >= 0 ||
        compareExactInstants(outcome.settledAt, result.createdAt) >= 0 ||
        compareExactInstants(membership.enrolledAt, snapshot.cutoffAt) > 0 ||
        compareExactInstants(snapshot.cutoffAt, snapshot.createdAt) > 0 ||
        compareExactInstants(snapshot.createdAt, result.createdAt) > 0 ||
        compareExactInstants(snapshot.cutoffAt, result.createdAt) > 0) {
      return DENY("DENY_CHRONOLOGY");
    }

    // 0.1 has no frozen ROI/refund/void/max-hit/denominator formulas, and its
    // result's sourceManifestDigest is not independently reconciled here.
    // Even a fully matching synthetic fixture MUST NOT receive scoring authority.
    return DENY("DENY_UNFROZEN_SCORING_CONTRACT");
  } catch {
    return DENY("DENY_INVALID_EVIDENCE");
  }
}
