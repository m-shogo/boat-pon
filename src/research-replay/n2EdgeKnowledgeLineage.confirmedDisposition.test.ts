import assert from "node:assert/strict";
import test from "node:test";

import type { N2ConfounderAuditItem } from "./n2ConfounderRejectionAudit";
import type { N2EdgeHistoricalConfirmationResult } from "./n2EdgeHistoricalConfirmation";
import { buildN2EdgeKnowledgeLineagePlan } from "./n2EdgeKnowledgeLineage";

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

const confirmation: N2EdgeHistoricalConfirmationResult = {
  hypothesisId: "N2EDGE-confirmed-disposition",
  featureKey: "firstCourse",
  bucket: "1",
  discoveryDirection: "underpredicted",
  validation: splitResult("validation"),
  test: splitResult("test"),
  verdict: "HISTORICAL_CONFIRMED",
};

function plan(disposition: N2ConfounderAuditItem["disposition"], blocking = false) {
  const auditItem: N2ConfounderAuditItem = {
    hypothesisId: confirmation.hypothesisId,
    historicalVerdict: "HISTORICAL_CONFIRMED",
    disposition,
    confounderFlags: blocking ? [{
      hypothesisId: confirmation.hypothesisId,
      flagId: "blocking-v1",
      severity: "blocking",
      detail: "blocking confounder",
    }] : [],
    promotionAuthorized: false,
  };
  return buildN2EdgeKnowledgeLineagePlan({
    confirmation,
    auditItem,
    scanArtifactDigest: DIGEST_A,
    historicalTestArtifactDigest: DIGEST_B,
    confounderAuditArtifactDigest: DIGEST_C,
    testedConditionCount: 37,
    totalTrialCount: 37,
    createdAt: "2026-08-28T04:10:00.000Z",
  });
}

test("confirmed historical evidence cannot be relabeled as rejected or insufficient lineage", () => {
  for (const disposition of ["REJECT_AND_REGISTER", "INSUFFICIENT_HOLDOUT"] as const) {
    const result = plan(disposition);
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.includes("AUDIT_DISPOSITION_INCONSISTENT"));
    assert.equal(result.experiment, null);
    assert.equal(result.registryPlan.experimentAppendEligible, false);
  }
});

test("confirmed disposition must match blocking-confounder presence", () => {
  assert.equal(plan("CONFIRMED_PENDING_CONFOUNDER_REVIEW").status, "PASS");
  assert.equal(plan("CONFIRMED_WITH_BLOCKING_CONFOUNDER", true).status, "PASS");
  assert.ok(plan("CONFIRMED_WITH_BLOCKING_CONFOUNDER").blockers.includes("AUDIT_DISPOSITION_INCONSISTENT"));
  assert.ok(plan("CONFIRMED_PENDING_CONFOUNDER_REVIEW", true).blockers.includes("AUDIT_DISPOSITION_INCONSISTENT"));
});
