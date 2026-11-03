import assert from "node:assert/strict";
import test from "node:test";
import {
  assessForwardScoringAdmission,
  type ForwardScoringEvidence,
} from "./forwardScoringAdmission";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  forwardVaultDigest,
} from "./forwardEvaluationVault";
import {
  RUNTIME_DECISION_LEDGER_SCHEMA_VERSION as DV,
  runtimeDecisionLedgerDigest,
} from "./runtimeDecisionLedger";
import { OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION as OV } from "./outcomeLearningLedger";

const digest = (character: string) => character.repeat(64);

function fixture(): ForwardScoringEvidence {
  const enrollment: ForwardScoringEvidence["enrollment"] = {
    schemaVersion: V, kind: "ENROLLMENT_PROTOCOL", recordId: "enrollment-record:synthetic",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-09-24T08:00:00Z",
    enrollmentProtocolId: "enrollment:synthetic", decisionSystem: "synthetic-shadow",
    eligibilityRules: ["synthetic-pit-rule"], startAt: "2026-09-24T08:30:00Z",
    endAt: null, ticketUniverse: ["trifecta"], protocolVersion: "synthetic-v1",
  };
  const decision: ForwardScoringEvidence["decision"] = {
    schemaVersion: DV, recordId: "decision-record:synthetic", decisionId: "decision:synthetic",
    canonicalRaceId: "race:synthetic", sourceDecisionHistoryId: null,
    decisionSystem: "synthetic-shadow", strategyVersion: "synthetic-v1",
    modelVersion: "synthetic-v1", featureVersion: "synthetic-v1",
    manifestId: "manifest:synthetic", cohortId: "cohort:synthetic",
    evaluationMode: "shadow_forward", ticketType: "trifecta", selection: "1-2-3",
    decision: "BUY", decisionAt: "2026-09-24T09:30:00Z",
    oddsObservedAt: "2026-09-24T09:20:00Z",
    scheduledCloseAtSeen: "2026-09-24T09:45:00Z",
    currentOdds: 2, requiredOdds: 1.5, estimatedHitRate: 0.5,
    rawEstimatedHitRate: 0.5, expectedValue: 1, recommendedStakeYen: 100,
    sampleSize: 1, reasons: ["synthetic"], warnings: [], dataCompleteness: "complete",
    notificationEligible: false, notificationDedupeKey: null, sourceRowDigest: digest("a"),
  };
  const membership: ForwardScoringEvidence["membership"] = {
    schemaVersion: V, kind: "MEMBERSHIP", recordId: "member:synthetic",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-09-24T09:15:00Z",
    cohortId: decision.cohortId, enrollmentProtocolId: enrollment.enrollmentProtocolId,
    enrollmentProtocolDigest: forwardVaultDigest(enrollment), canonicalRaceId: decision.canonicalRaceId,
    decisionRecordId: decision.recordId, decisionRecordDigest: runtimeDecisionLedgerDigest(decision),
    enrolledAt: "2026-09-24T09:15:00Z", included: true, reason: "prospective synthetic rule",
  };
  const snapshot: ForwardScoringEvidence["snapshot"] = {
    schemaVersion: V, kind: "ANALYSIS_SNAPSHOT", recordId: "snapshot-record:synthetic",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-09-24T10:30:00Z",
    analysisSnapshotId: "snapshot:synthetic", cohortId: membership.cohortId,
    cutoffAt: "2026-09-24T10:30:00Z", membershipDigests: [forwardVaultDigest(membership)],
  };
  const protocol: ForwardScoringEvidence["protocol"] = {
    schemaVersion: V, kind: "EVALUATION_PROTOCOL", recordId: "protocol-record:synthetic",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-09-24T09:00:00Z",
    evaluationProtocolId: "eval:synthetic", comparisonMode: "COMMON_COHORT", oddsBasis: "BUY_TIME",
    metricFamilies: ["ROI"], unresolvedPolicy: "EXCLUDE_AND_COUNT",
    benchmarkDecisionSystems: ["synthetic-shadow"], protocolVersion: "synthetic-v1",
  };
  const outcome: ForwardScoringEvidence["outcome"] = {
    schemaVersion: OV, outcomeRecordId: "outcome:synthetic", decisionRecordId: decision.recordId,
    decisionId: decision.decisionId, canonicalRaceId: decision.canonicalRaceId,
    ticketType: decision.ticketType, selection: decision.selection,
    settlementId: "settlement:synthetic", settledAt: "2026-09-24T10:00:00Z",
    finality: "FINAL", disposition: "SETTLED", evaluable: true,
    stakeYen: 100, payoutYen: 0, refundYen: 0, refundReason: null,
    popularity: null, sourceEvidenceDigests: [digest("b")], provenanceVersion: "synthetic-v1",
  };
  const result: ForwardScoringEvidence["result"] = {
    schemaVersion: V, kind: "RESULT", recordId: "result-record:synthetic",
    evidenceStage: "SHADOW_FORWARD", createdAt: "2026-09-24T11:00:00Z",
    resultId: "result:synthetic", analysisSnapshotId: snapshot.analysisSnapshotId,
    analysisSnapshotDigest: forwardVaultDigest(snapshot), evaluationProtocolId: protocol.evaluationProtocolId,
    evaluationProtocolDigest: forwardVaultDigest(protocol), decisionSystem: decision.decisionSystem,
    comparisonMode: protocol.comparisonMode, oddsBasis: protocol.oddsBasis, metricFamily: "ROI",
    includedCount: 1, excludedCount: 0, metrics: { roi: 0 },
    sourceManifestDigest: digest("c"), evaluatorVersion: "synthetic-v1",
  };
  return { enrollment, membership, snapshot, protocol, result, decision, outcome, reconciliation: "EXACT" };
}

const reason = (input: unknown) => assessForwardScoringAdmission(input).reason;

test("complete synthetic v0.1 evidence remains explicitly unscorable", () => {
  const admission = assessForwardScoringAdmission(fixture());
  assert.deepEqual(admission, {
    scoringAuthorized: false,
    reason: "DENY_UNFROZEN_SCORING_CONTRACT",
  });
});

test("invalid and accessor evidence fails closed", () => {
  assert.equal(reason(null), "DENY_INVALID_EVIDENCE");
  assert.equal(reason({}), "DENY_INVALID_EVIDENCE");
  const broken = Object.defineProperty({ ...fixture() }, "outcome", {
    enumerable: true, get() { throw new Error("synthetic accessor"); },
  });
  assert.equal(reason(broken), "DENY_INVALID_EVIDENCE");
});

test("caller-provided reconciliation cannot substitute for EXACT", () => {
  assert.equal(reason({ ...fixture(), reconciliation: "UNRESOLVED_TICKET_LINK" }), "DENY_RECONCILIATION");
  assert.equal(reason({ ...fixture(), reconciliation: "CONFLICT" }), "DENY_RECONCILIATION");
});

test("REFUNDED and VOID remain retained but never scored", () => {
  const refunded = fixture();
  refunded.outcome.disposition = "REFUNDED";
  refunded.outcome.evaluable = false;
  refunded.outcome.refundYen = 100;
  refunded.outcome.refundReason = "synthetic-refund";
  assert.equal(reason(refunded), "DENY_NOT_EVALUABLE");
  const voided = fixture();
  voided.outcome.disposition = "VOID";
  voided.outcome.finality = "VOID";
  voided.outcome.evaluable = false;
  voided.outcome.refundReason = "synthetic-void";
  assert.equal(reason(voided), "DENY_NONFINAL");
});

test("unresolved or revised terminal semantics cannot become FINAL by assertion", () => {
  const pending = fixture();
  assert.equal(reason({ ...pending, outcome: { ...pending.outcome, finality: "PENDING" } }), "DENY_INVALID_EVIDENCE");
  assert.equal(reason({ ...pending, outcome: { ...pending.outcome, finality: "REVISED" } }), "DENY_INVALID_EVIDENCE");
});

test("ticket, decision, cohort, and digest mismatches deny admission", () => {
  const x = fixture();
  assert.equal(reason({ ...x, outcome: { ...x.outcome, selection: "3-2-1" } }), "DENY_IDENTITY_OR_DIGEST");
  assert.equal(reason({ ...x, outcome: { ...x.outcome, decisionRecordId: "different" } }), "DENY_IDENTITY_OR_DIGEST");
  assert.equal(reason({ ...x, membership: { ...x.membership, cohortId: "different" } }), "DENY_IDENTITY_OR_DIGEST");
  assert.equal(reason({ ...x, snapshot: { ...x.snapshot, membershipDigests: [digest("d")] } }), "DENY_IDENTITY_OR_DIGEST");
});

test("stage relabeling cannot manufacture shadow-forward evidence", () => {
  const x = fixture();
  assert.equal(reason({ ...x, result: { ...x.result, evidenceStage: "HISTORICAL" } }), "DENY_STAGE");
  const historicalDecision = { ...x.decision, evaluationMode: "historical" as const };
  const historicalMembership = { ...x.membership, decisionRecordDigest: runtimeDecisionLedgerDigest(historicalDecision) };
  const historicalSnapshot = { ...x.snapshot, membershipDigests: [forwardVaultDigest(historicalMembership)] };
  const historicalResult = { ...x.result, analysisSnapshotDigest: forwardVaultDigest(historicalSnapshot) };
  assert.equal(reason({ ...x, decision: historicalDecision, membership: historicalMembership,
    snapshot: historicalSnapshot, result: historicalResult }), "DENY_STAGE");
});

test("post-decision protocols and post-decision enrollment fail prospectivity", () => {
  const x = fixture();
  const lateProtocol = { ...x.protocol, createdAt: "2026-09-24T09:31:00Z" };
  const lateResult = { ...x.result, evaluationProtocolDigest: forwardVaultDigest(lateProtocol) };
  assert.equal(reason({ ...x, protocol: lateProtocol, result: lateResult }), "DENY_CHRONOLOGY");
  const lateMembership = { ...x.membership, enrolledAt: "2026-09-24T09:31:00Z" };
  const lateSnapshot = { ...x.snapshot, membershipDigests: [forwardVaultDigest(lateMembership)] };
  const lateResult2 = { ...x.result, analysisSnapshotDigest: forwardVaultDigest(lateSnapshot) };
  assert.equal(reason({ ...x, membership: lateMembership, snapshot: lateSnapshot, result: lateResult2 }), "DENY_CHRONOLOGY");
});

test("submillisecond chronology is checked without rounding away the order", () => {
  const x = fixture();
  const protocol = { ...x.protocol, createdAt: "2026-09-24T09:30:00.000000002Z" };
  const decision = { ...x.decision, decisionAt: "2026-09-24T09:30:00.000000001Z" };
  const membership = { ...x.membership, decisionRecordDigest: runtimeDecisionLedgerDigest(decision) };
  const snapshot = { ...x.snapshot, membershipDigests: [forwardVaultDigest(membership)] };
  const result = { ...x.result, analysisSnapshotDigest: forwardVaultDigest(snapshot),
    evaluationProtocolDigest: forwardVaultDigest(protocol) };
  assert.equal(reason({ ...x, protocol, decision, membership, snapshot, result }), "DENY_CHRONOLOGY");
});

test("invented scoring fields do not retrofit v0.1 into a frozen v0.2", () => {
  const x = fixture();
  assert.equal(reason({ ...x, protocol: { ...x.protocol, refundTreatment: "EXCLUDE_AND_COUNT" } }),
    "DENY_INVALID_EVIDENCE");
  assert.equal(reason({ ...x, protocol: { ...x.protocol, formula: "arbitrary" } }),
    "DENY_INVALID_EVIDENCE");
});

test("result cannot predate authoritative settlement or cohort snapshot cutoff", () => {
  const x = fixture();
  const lateOutcome = { ...x.outcome, settledAt: "2026-09-24T11:01:00Z" };
  assert.equal(reason({ ...x, outcome: lateOutcome }), "DENY_CHRONOLOGY");
  const earlySnapshot = { ...x.snapshot, cutoffAt: "2026-09-24T09:14:59Z" };
  const reboundResult = { ...x.result, analysisSnapshotDigest: forwardVaultDigest(earlySnapshot) };
  assert.equal(reason({ ...x, snapshot: earlySnapshot, result: reboundResult }), "DENY_CHRONOLOGY");
});

test("enrollment system and ticket universe are bound to the exact decision", () => {
  const x = fixture();
  for (const enrollment of [
    { ...x.enrollment, decisionSystem: "different-system" },
    { ...x.enrollment, ticketUniverse: ["other-ticket"] },
  ]) {
    const membership = { ...x.membership, enrollmentProtocolDigest: forwardVaultDigest(enrollment) };
    const snapshot = { ...x.snapshot, membershipDigests: [forwardVaultDigest(membership)] };
    const result = { ...x.result, analysisSnapshotDigest: forwardVaultDigest(snapshot) };
    assert.equal(reason({ ...x, enrollment, membership, snapshot, result }), "DENY_IDENTITY_OR_DIGEST");
  }
});

test("backdated membership creation and late snapshot authoring cannot be prospective", () => {
  const x = fixture();
  const lateMembership = { ...x.membership, createdAt: "2026-09-24T09:31:00Z" };
  const snapshot = { ...x.snapshot, membershipDigests: [forwardVaultDigest(lateMembership)] };
  const result = { ...x.result, analysisSnapshotDigest: forwardVaultDigest(snapshot) };
  assert.equal(reason({ ...x, membership: lateMembership, snapshot, result }), "DENY_CHRONOLOGY");
  const lateSnapshot = { ...x.snapshot, createdAt: "2026-09-24T11:01:00Z" };
  const reboundResult = { ...x.result, analysisSnapshotDigest: forwardVaultDigest(lateSnapshot) };
  assert.equal(reason({ ...x, snapshot: lateSnapshot, result: reboundResult }), "DENY_CHRONOLOGY");
  const backdatedCutoff = { ...x.snapshot, cutoffAt: "2026-09-24T10:31:00Z" };
  const reboundResult2 = { ...x.result, analysisSnapshotDigest: forwardVaultDigest(backdatedCutoff) };
  assert.equal(reason({ ...x, snapshot: backdatedCutoff, result: reboundResult2 }), "DENY_CHRONOLOGY");
});

test("v0.1 scoring denial cannot be rewritten by a runtime consumer", () => {
  const assessments = [
    assessForwardScoringAdmission(fixture()),
    assessForwardScoringAdmission(null),
  ];
  for (const result of assessments) {
    assert.equal(Object.isFrozen(result), true);
    assert.equal(result.scoringAuthorized, false);
    assert.throws(() => {
      (result as unknown as { scoringAuthorized: boolean }).scoringAuthorized = true;
    }, TypeError);
    assert.throws(() => {
      (result as unknown as { reason: string }).reason = "AUTHORIZED";
    }, TypeError);
    assert.equal(result.scoringAuthorized, false);
  }
  assert.equal(assessments[0]!.reason, "DENY_UNFROZEN_SCORING_CONTRACT");
  assert.equal(assessments[1]!.reason, "DENY_INVALID_EVIDENCE");
});
