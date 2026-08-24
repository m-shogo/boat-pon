import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { N2ConfounderAuditItem } from "./n2ConfounderRejectionAudit";
import type { N2EdgeHistoricalConfirmationResult } from "./n2EdgeHistoricalConfirmation";
import { buildN2EdgeKnowledgeLineagePlan } from "./n2EdgeKnowledgeLineage";
import {
  N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT,
  persistN2EdgeKnowledgeLineage,
} from "./n2EdgeKnowledgeRegistryPersistence";

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

function reviewedPlan() {
  const confirmation: N2EdgeHistoricalConfirmationResult = {
    hypothesisId: "N2EDGE-plan-digest",
    featureKey: "firstCourse",
    bucket: "1",
    discoveryDirection: "underpredicted",
    validation: splitResult("validation"),
    test: splitResult("test"),
    verdict: "HISTORICAL_CONFIRMED",
  };
  const auditItem: N2ConfounderAuditItem = {
    hypothesisId: confirmation.hypothesisId,
    historicalVerdict: confirmation.verdict,
    disposition: "CONFIRMED_PENDING_CONFOUNDER_REVIEW",
    confounderFlags: [],
    promotionAuthorized: false,
  };
  return buildN2EdgeKnowledgeLineagePlan({
    confirmation,
    auditItem,
    scanArtifactDigest: "a".repeat(64),
    historicalTestArtifactDigest: "b".repeat(64),
    confounderAuditArtifactDigest: "c".repeat(64),
    testedConditionCount: 37,
    totalTrialCount: 37,
    createdAt: "2026-08-24T05:00:00.000Z",
  });
}

test("persistence rejects a semantically valid plan mutated after review", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-plan-digest-"));
  const registryRoot = join(root, "research/registries");
  try {
    const plan = reviewedPlan();
    assert.equal(plan.status, "PASS");
    assert.ok(plan.discoveryCandidate);

    const tampered = {
      ...plan,
      discoveryCandidate: {
        ...plan.discoveryCandidate!,
        finding: `${plan.discoveryCandidate!.finding} tampered after review`,
      },
    };
    const outcome = persistN2EdgeKnowledgeLineage({
      repoRoot: root,
      registryRoot,
      plan: tampered,
      writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT,
    });

    assert.equal(outcome.status, "BLOCKED");
    assert.ok(outcome.blockers.includes("LINEAGE_PLAN_OUTPUT_DIGEST_MISMATCH"));
    assert.equal(outcome.experiment.appended, false);
    assert.equal(outcome.discovery.appended, false);
    assert.equal(existsSync(registryRoot), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("untampered reviewed plan remains append-eligible", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-plan-digest-valid-"));
  const registryRoot = join(root, "research/registries");
  try {
    const outcome = persistN2EdgeKnowledgeLineage({
      repoRoot: root,
      registryRoot,
      plan: reviewedPlan(),
      writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT,
    });
    assert.equal(outcome.status, "PASS", outcome.blockers.join("; "));
    assert.equal(outcome.experiment.appended, true);
    assert.equal(outcome.discovery.appended, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
