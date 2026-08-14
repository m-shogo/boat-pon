import assert from "node:assert/strict";
import test from "node:test";

import type { N2ConfounderAuditItem } from "./n2ConfounderRejectionAudit";
import type { N2EdgeHistoricalConfirmationResult } from "./n2EdgeHistoricalConfirmation";
import { buildN2EdgeKnowledgeLineagePlan } from "./n2EdgeKnowledgeLineage";
import { validateDiscovery, validateExperiment } from "../research/governance/contracts";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

function splitResult(split: "validation" | "test") {
  return {
    split,
    uniqueRaceCount: 220,
    meanResidual: 0.02,
    standardError: 0.002,
    zScore: 10,
    rawPValue: 1e-8,
    holmAdjustedPValue: 1e-8,
    supportSufficient: true,
    effectSufficient: true,
    directionMatchesDiscovery: true,
    statisticallyConfirmed: true,
  };
}

function confirmation(
  verdict: N2EdgeHistoricalConfirmationResult["verdict"] = "HISTORICAL_CONFIRMED",
): N2EdgeHistoricalConfirmationResult {
  return {
    hypothesisId: "N2EDGE-knowledge-test",
    featureKey: "firstCourse",
    bucket: "1",
    discoveryDirection: "underpredicted",
    validation: splitResult("validation"),
    test: splitResult("test"),
    verdict,
  };
}

function auditItem(
  disposition: N2ConfounderAuditItem["disposition"] = "CONFIRMED_PENDING_CONFOUNDER_REVIEW",
  historicalVerdict: N2EdgeHistoricalConfirmationResult["verdict"] = "HISTORICAL_CONFIRMED",
): N2ConfounderAuditItem {
  return {
    hypothesisId: "N2EDGE-knowledge-test",
    historicalVerdict,
    disposition,
    confounderFlags: [],
    promotionAuthorized: false,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    confirmation: confirmation(),
    auditItem: auditItem(),
    scanArtifactDigest: DIGEST_A,
    historicalTestArtifactDigest: DIGEST_B,
    confounderAuditArtifactDigest: DIGEST_C,
    testedConditionCount: 37,
    totalTrialCount: 37,
    createdAt: "2026-08-08T10:00:00.000Z",
    ...overrides,
  } as Parameters<typeof buildN2EdgeKnowledgeLineagePlan>[0];
}

test("confirmed-pending hypothesis creates a valid experiment plus reusable discovery candidate", () => {
  const plan = buildN2EdgeKnowledgeLineagePlan(input());
  assert.equal(plan.status, "PASS");
  assert.ok(plan.experiment);
  assert.ok(plan.discoveryCandidate);
  assert.equal(validateExperiment(plan.experiment).valid, true);
  assert.equal(validateDiscovery(plan.discoveryCandidate).valid, true);
  assert.equal(plan.experiment.status, "completed");
  assert.equal(plan.experiment.evidenceStage, "holdout");
  assert.equal(plan.experiment.trialFamilyId, "N2-EDGE-V1");
  assert.deepEqual(plan.discoveryCandidate.sourceExperimentIds, [plan.experiment.experimentId]);
  assert.equal(plan.discoveryCandidate.evidenceLevel, "moderate");
  assert.equal(plan.discoveryCandidate.shareClass, "REUSABLE_CANDIDATE");
  assert.deepEqual(plan.discoveryCandidate.adoptedBy, []);
  assert.match(plan.discoveryCandidate.scope, /no Current BUY/u);
  assert.equal(plan.registryPlan.registryWriteAuthorized, false);
  assert.equal(plan.authority.automaticPromotionAuthorized, false);
  assert.equal(plan.authority.currentBuyConnectionAuthorized, false);
});

test("lineage accepts valid leap-day timestamps with offsets", () => {
  const plan = buildN2EdgeKnowledgeLineagePlan(input({ createdAt: "2028-02-29T19:00:00+09:00" }));
  assert.equal(plan.status, "PASS", plan.blockers.join("; "));
});

test("lineage rejects impossible calendar dates normalized by Date.parse", () => {
  for (const createdAt of [
    "2026-02-29T10:00:00.000Z",
    "2026-02-30T10:00:00.000Z",
    "2026-04-31T19:00:00+09:00",
  ]) {
    const plan = buildN2EdgeKnowledgeLineagePlan(input({ createdAt }));
    assert.equal(plan.status, "BLOCKED", createdAt);
    assert.ok(plan.blockers.includes("CREATED_AT_INVALID"), createdAt);
    assert.equal(plan.registryPlan.experimentAppendEligible, false, createdAt);
    assert.equal(plan.registryPlan.discoveryAppendEligible, false, createdAt);
  }
});

test("historical rejection creates only a rejected experiment, never a discovery", () => {
  const plan = buildN2EdgeKnowledgeLineagePlan(input({
    confirmation: confirmation("HISTORICAL_REJECTED"),
    auditItem: auditItem("REJECT_AND_REGISTER", "HISTORICAL_REJECTED"),
  }));
  assert.equal(plan.status, "PASS");
  assert.equal(plan.experiment?.status, "rejected");
  assert.equal(plan.discoveryCandidate, null);
  assert.equal(plan.registryPlan.experimentAppendEligible, true);
  assert.equal(plan.registryPlan.discoveryAppendEligible, false);
  assert.equal(plan.invariants.historicalRejectionCreatesDiscovery, false);
});

test("insufficient holdout creates an inconclusive experiment, not a discovery", () => {
  const plan = buildN2EdgeKnowledgeLineagePlan(input({
    confirmation: confirmation("INSUFFICIENT_HOLDOUT"),
    auditItem: auditItem("INSUFFICIENT_HOLDOUT", "INSUFFICIENT_HOLDOUT"),
  }));
  assert.equal(plan.status, "PASS");
  assert.equal(plan.experiment?.status, "inconclusive");
  assert.equal(plan.discoveryCandidate, null);
  assert.equal(plan.invariants.insufficientHoldoutCreatesDiscovery, false);
});

test("confirmed hypothesis with blocking confounder creates a completed experiment but no discovery", () => {
  const item = auditItem("CONFIRMED_WITH_BLOCKING_CONFOUNDER", "HISTORICAL_CONFIRMED");
  item.confounderFlags = [{
    hypothesisId: item.hypothesisId,
    flagId: "holdout-distribution-concentration-v1",
    severity: "blocking",
    detail: "frozen concentration policy blocked",
  }];
  const plan = buildN2EdgeKnowledgeLineagePlan(input({ auditItem: item }));
  assert.equal(plan.status, "PASS");
  assert.equal(plan.experiment?.status, "completed");
  assert.equal(plan.discoveryCandidate, null);
  assert.equal(plan.invariants.blockingConfounderCreatesDiscovery, false);
});

test("lineage identity is deterministic and binds all three source artifact digests", () => {
  const first = buildN2EdgeKnowledgeLineagePlan(input());
  const second = buildN2EdgeKnowledgeLineagePlan(input());
  assert.equal(first.outputDigest, second.outputDigest);
  assert.equal(first.experiment?.experimentId, second.experiment?.experimentId);
  assert.equal(first.discoveryCandidate?.discoveryId, second.discoveryCandidate?.discoveryId);

  const changed = buildN2EdgeKnowledgeLineagePlan(input({ confounderAuditArtifactDigest: "d".repeat(64) }));
  assert.notEqual(first.experiment?.experimentId, changed.experiment?.experimentId);
  assert.notEqual(first.discoveryCandidate?.discoveryId, changed.discoveryCandidate?.discoveryId);
  assert.match(first.experiment!.dataSnapshot, new RegExp(DIGEST_A));
  assert.match(first.experiment!.dataSnapshot, new RegExp(DIGEST_B));
  assert.match(first.experiment!.dataSnapshot, new RegExp(DIGEST_C));
});

test("mismatched audit, invalid digests, invalid counts and unauthorized promotion fail closed", () => {
  const mismatch = buildN2EdgeKnowledgeLineagePlan(input({
    auditItem: { ...auditItem(), hypothesisId: "N2EDGE-other" },
  }));
  assert.equal(mismatch.status, "BLOCKED");
  assert.ok(mismatch.blockers.includes("AUDIT_CONFIRMATION_HYPOTHESIS_MISMATCH"));
  assert.equal(mismatch.experiment, null);
  assert.equal(mismatch.discoveryCandidate, null);

  const invalid = buildN2EdgeKnowledgeLineagePlan(input({
    scanArtifactDigest: "bad",
    testedConditionCount: 5,
    totalTrialCount: 4,
    createdAt: "bad-date",
  }));
  assert.equal(invalid.status, "BLOCKED");
  assert.ok(invalid.blockers.includes("SCAN_ARTIFACT_DIGEST_INVALID"));
  assert.ok(invalid.blockers.includes("TOTAL_TRIAL_COUNT_INVALID"));
  assert.ok(invalid.blockers.includes("CREATED_AT_INVALID"));

  const item = auditItem();
  (item as { promotionAuthorized: boolean }).promotionAuthorized = true;
  const authority = buildN2EdgeKnowledgeLineagePlan(input({ auditItem: item }));
  assert.equal(authority.status, "BLOCKED");
  assert.ok(authority.blockers.includes("AUDIT_PROMOTION_AUTHORITY_INVALID"));
});

test("a discovery-eligible disposition cannot be paired with a non-confirmed verdict", () => {
  const plan = buildN2EdgeKnowledgeLineagePlan(input({
    confirmation: confirmation("HISTORICAL_REJECTED"),
    auditItem: auditItem("CONFIRMED_PENDING_CONFOUNDER_REVIEW", "HISTORICAL_REJECTED"),
  }));
  assert.equal(plan.status, "BLOCKED");
  assert.ok(plan.blockers.includes("DISCOVERY_ELIGIBLE_DISPOSITION_WITHOUT_HISTORICAL_CONFIRMATION"));
  assert.equal(plan.discoveryCandidate, null);
});
