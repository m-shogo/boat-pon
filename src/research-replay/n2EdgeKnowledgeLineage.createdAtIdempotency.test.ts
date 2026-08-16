import assert from "node:assert/strict";
import test from "node:test";

import type { N2ConfounderAuditItem } from "./n2ConfounderRejectionAudit";
import type { N2EdgeHistoricalConfirmationResult } from "./n2EdgeHistoricalConfirmation";
import { buildN2EdgeKnowledgeLineagePlan } from "./n2EdgeKnowledgeLineage";

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

function confirmation(): N2EdgeHistoricalConfirmationResult {
  return {
    hypothesisId: "N2EDGE-created-at-idempotency",
    featureKey: "firstCourse",
    bucket: "1",
    discoveryDirection: "underpredicted",
    validation: splitResult("validation"),
    test: splitResult("test"),
    verdict: "HISTORICAL_CONFIRMED",
  };
}

function auditItem(): N2ConfounderAuditItem {
  return {
    hypothesisId: "N2EDGE-created-at-idempotency",
    historicalVerdict: "HISTORICAL_CONFIRMED",
    disposition: "CONFIRMED_PENDING_CONFOUNDER_REVIEW",
    confounderFlags: [],
    promotionAuthorized: false,
  };
}

function plan(createdAt: string) {
  return buildN2EdgeKnowledgeLineagePlan({
    confirmation: confirmation(),
    auditItem: auditItem(),
    scanArtifactDigest: "a".repeat(64),
    historicalTestArtifactDigest: "b".repeat(64),
    confounderAuditArtifactDigest: "c".repeat(64),
    testedConditionCount: 40,
    totalTrialCount: 40,
    createdAt,
  });
}

test("equivalent createdAt instants produce identical append-only lineage bodies", () => {
  const utc = plan("2026-08-08T12:00:00.000Z");
  const offset = plan("2026-08-08T21:00:00+09:00");

  assert.equal(utc.status, "PASS");
  assert.equal(offset.status, "PASS");
  assert.deepEqual(offset, utc);
  assert.equal(offset.experiment?.createdAt, "2026-08-08T12:00:00.000Z");
  assert.equal(offset.discoveryCandidate?.createdAt, "2026-08-08T12:00:00.000Z");
});
