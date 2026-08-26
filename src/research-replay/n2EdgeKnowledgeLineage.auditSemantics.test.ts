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

function confirmation(
  verdict: N2EdgeHistoricalConfirmationResult["verdict"] = "HISTORICAL_CONFIRMED",
): N2EdgeHistoricalConfirmationResult {
  return {
    hypothesisId: "N2EDGE-audit-semantics",
    featureKey: "firstCourse",
    bucket: "1",
    discoveryDirection: "underpredicted",
    validation: splitResult("validation"),
    test: splitResult("test"),
    verdict,
  };
}

function auditItem(
  disposition: N2ConfounderAuditItem["disposition"],
  flags: N2ConfounderAuditItem["confounderFlags"] = [],
  historicalVerdict: N2EdgeHistoricalConfirmationResult["verdict"] = "HISTORICAL_CONFIRMED",
): N2ConfounderAuditItem {
  return {
    hypothesisId: "N2EDGE-audit-semantics",
    historicalVerdict,
    disposition,
    confounderFlags: flags,
    promotionAuthorized: false,
  };
}

function plan(audit: N2ConfounderAuditItem, confirmed = confirmation()) {
  return buildN2EdgeKnowledgeLineagePlan({
    confirmation: confirmed,
    auditItem: audit,
    scanArtifactDigest: DIGEST_A,
    historicalTestArtifactDigest: DIGEST_B,
    confounderAuditArtifactDigest: DIGEST_C,
    testedConditionCount: 37,
    totalTrialCount: 37,
    createdAt: "2026-08-24T04:40:00.000Z",
  });
}

test("blocking confounder cannot be relabeled discovery-eligible", () => {
  const blockingFlag = {
    hypothesisId: "N2EDGE-audit-semantics",
    flagId: "venue-concentration-v1",
    severity: "blocking" as const,
    detail: "frozen concentration policy blocked",
  };
  const forged = plan(auditItem("CONFIRMED_PENDING_CONFOUNDER_REVIEW", [blockingFlag]));
  assert.equal(forged.status, "BLOCKED");
  assert.ok(forged.blockers.includes("AUDIT_DISPOSITION_INCONSISTENT"));
  assert.equal(forged.discoveryCandidate, null);
  assert.equal(forged.registryPlan.discoveryAppendEligible, false);

  const canonical = plan(auditItem("CONFIRMED_WITH_BLOCKING_CONFOUNDER", [blockingFlag]));
  assert.equal(canonical.status, "PASS", canonical.blockers.join("; "));
  assert.equal(canonical.discoveryCandidate, null);
});

test("unknown confounder severity cannot downgrade blocking evidence into discovery eligibility", () => {
  const forgedFlag = {
    hypothesisId: "N2EDGE-audit-semantics",
    flagId: "venue-concentration-v1",
    severity: "critical",
    detail: "tampered severity must not become non-blocking",
  } as unknown as N2ConfounderAuditItem["confounderFlags"][number];
  const forged = plan(auditItem("CONFIRMED_PENDING_CONFOUNDER_REVIEW", [forgedFlag]));
  assert.equal(forged.status, "BLOCKED");
  assert.ok(forged.blockers.includes("AUDIT_CONFOUNDER_FLAG_SEVERITY_INVALID"));
  assert.equal(forged.discoveryCandidate, null);
  assert.equal(forged.registryPlan.discoveryAppendEligible, false);
});

test("confounder flags must belong to the audited hypothesis", () => {
  const foreignFlag = {
    hypothesisId: "N2EDGE-other",
    flagId: "foreign-blocker-v1",
    severity: "warning" as const,
    detail: "belongs to another hypothesis",
  };
  const forged = plan(auditItem("CONFIRMED_PENDING_CONFOUNDER_REVIEW", [foreignFlag]));
  assert.equal(forged.status, "BLOCKED");
  assert.ok(forged.blockers.includes("AUDIT_CONFOUNDER_FLAG_HYPOTHESIS_MISMATCH"));
  assert.equal(forged.discoveryCandidate, null);
});

test("historical verdict determines canonical audit disposition", () => {
  const rejected = confirmation("HISTORICAL_REJECTED");
  const forgedRejected = plan(
    auditItem("INSUFFICIENT_HOLDOUT", [], "HISTORICAL_REJECTED"),
    rejected,
  );
  assert.equal(forgedRejected.status, "BLOCKED");
  assert.ok(forgedRejected.blockers.includes("AUDIT_DISPOSITION_INCONSISTENT"));

  const insufficient = confirmation("INSUFFICIENT_HOLDOUT");
  const forgedInsufficient = plan(
    auditItem("REJECT_AND_REGISTER", [], "INSUFFICIENT_HOLDOUT"),
    insufficient,
  );
  assert.equal(forgedInsufficient.status, "BLOCKED");
  assert.ok(forgedInsufficient.blockers.includes("AUDIT_DISPOSITION_INCONSISTENT"));
});
