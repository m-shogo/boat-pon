import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

function confirmation(verdict: N2EdgeHistoricalConfirmationResult["verdict"] = "HISTORICAL_CONFIRMED"): N2EdgeHistoricalConfirmationResult {
  return {
    hypothesisId: "N2EDGE-persist-test",
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
    hypothesisId: "N2EDGE-persist-test",
    historicalVerdict,
    disposition,
    confounderFlags: [],
    promotionAuthorized: false,
  };
}

function plan(input: {
  verdict?: N2EdgeHistoricalConfirmationResult["verdict"];
  disposition?: N2ConfounderAuditItem["disposition"];
} = {}) {
  const verdict = input.verdict ?? "HISTORICAL_CONFIRMED";
  const disposition = input.disposition ?? "CONFIRMED_PENDING_CONFOUNDER_REVIEW";
  return buildN2EdgeKnowledgeLineagePlan({
    confirmation: confirmation(verdict),
    auditItem: auditItem(disposition, verdict),
    scanArtifactDigest: DIGEST_A,
    historicalTestArtifactDigest: DIGEST_B,
    confounderAuditArtifactDigest: DIGEST_C,
    testedConditionCount: 40,
    totalTrialCount: 40,
    createdAt: "2026-08-08T12:00:00.000Z",
  });
}

function withRoot(fn: (root: string, registryRoot: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-knowledge-registry-"));
  const registryRoot = join(root, "research/registries");
  try {
    fn(root, registryRoot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("confirmed-pending appends Experiment first and then an unadopted Discovery candidate", () => {
  withRoot((root, registryRoot) => {
    const lineage = plan();
    assert.equal(lineage.status, "PASS");
    const outcome = persistN2EdgeKnowledgeLineage({
      repoRoot: root,
      registryRoot,
      plan: lineage,
      writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT,
    });
    assert.equal(outcome.status, "PASS");
    assert.equal(outcome.experiment.appended, true);
    assert.equal(outcome.discovery.appended, true);
    assert.match(outcome.experiment.outputPath!, /^research\/registries\/experiments\/EXP-N2EDGE-/u);
    assert.match(outcome.discovery.outputPath!, /^research\/registries\/discoveries\/DISC-N2EDGE-/u);
    assert.equal(outcome.discoveryAdoptedByCount, 0);
    assert.equal(outcome.currentBuyTransferAuthorized, false);
    assert.equal(outcome.lineTransferAuthorized, false);
    assert.equal(outcome.publicPublishAuthorized, false);
    assert.equal(outcome.automatedBettingAuthorized, false);
    assert.equal(outcome.productionApplyAuthorized, false);

    const experiments = readdirSync(join(registryRoot, "experiments")).filter((name) => name.endsWith(".json"));
    const discoveries = readdirSync(join(registryRoot, "discoveries")).filter((name) => name.endsWith(".json"));
    assert.equal(experiments.length, 1);
    assert.equal(discoveries.length, 1);
    const experiment = JSON.parse(readFileSync(join(registryRoot, "experiments", experiments[0]), "utf8"));
    const discovery = JSON.parse(readFileSync(join(registryRoot, "discoveries", discoveries[0]), "utf8"));
    assert.equal(experiment.status, "completed");
    assert.deepEqual(discovery.sourceExperimentIds, [experiment.experimentId]);
    assert.deepEqual(discovery.adoptedBy, []);
    assert.match(discovery.scope, /no Current BUY/u);
  });
});

test("exact retry is idempotent and creates no duplicate registry records", () => {
  withRoot((root, registryRoot) => {
    const lineage = plan();
    const first = persistN2EdgeKnowledgeLineage({ repoRoot: root, registryRoot, plan: lineage, writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT });
    const second = persistN2EdgeKnowledgeLineage({ repoRoot: root, registryRoot, plan: lineage, writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT });
    assert.equal(first.status, "PASS");
    assert.equal(second.status, "PASS");
    assert.equal(second.experiment.alreadyRecorded, true);
    assert.equal(second.experiment.appended, false);
    assert.equal(second.discovery.alreadyRecorded, true);
    assert.equal(second.discovery.appended, false);
    assert.equal(readdirSync(join(registryRoot, "experiments")).filter((name) => name.endsWith(".json")).length, 1);
    assert.equal(readdirSync(join(registryRoot, "discoveries")).filter((name) => name.endsWith(".json")).length, 1);
  });
});

test("rejected and insufficient outcomes persist only the governed Experiment, never Discovery", () => {
  withRoot((root, registryRoot) => {
    for (const [verdict, disposition, expectedStatus] of [
      ["HISTORICAL_REJECTED", "REJECT_AND_REGISTER", "rejected"],
      ["INSUFFICIENT_HOLDOUT", "INSUFFICIENT_HOLDOUT", "inconclusive"],
    ] as const) {
      const current = plan({ verdict, disposition });
      const outcome = persistN2EdgeKnowledgeLineage({ repoRoot: root, registryRoot, plan: current, writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT });
      assert.equal(outcome.status, "PASS");
      assert.equal(outcome.experiment.appended, true);
      assert.equal(outcome.discovery.recordId, null);
      assert.equal(outcome.discovery.appended, false);
      const file = `${current.experiment!.experimentId}.json`;
      const stored = JSON.parse(readFileSync(join(registryRoot, "experiments", file), "utf8"));
      assert.equal(stored.status, expectedStatus);
    }
    assert.equal(readdirSync(join(registryRoot, "discoveries")).filter((name) => name.endsWith(".json")).length, 0);
  });
});

test("blocking confounder persists completed Experiment but never Discovery", () => {
  withRoot((root, registryRoot) => {
    const current = plan({ disposition: "CONFIRMED_WITH_BLOCKING_CONFOUNDER" });
    const outcome = persistN2EdgeKnowledgeLineage({ repoRoot: root, registryRoot, plan: current, writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT });
    assert.equal(outcome.status, "PASS");
    assert.equal(outcome.experiment.appended, true);
    assert.equal(outcome.discovery.recordId, null);
    assert.equal(readdirSync(join(registryRoot, "discoveries")).filter((name) => name.endsWith(".json")).length, 0);
  });
});

test("conflicting existing Experiment blocks before any Discovery write", () => {
  withRoot((root, registryRoot) => {
    const current = plan();
    const experimentDir = join(registryRoot, "experiments");
    mkdirSync(experimentDir, { recursive: true });
    const conflict = { ...current.experiment!, hypothesis: "tampered hypothesis" };
    writeFileSync(join(experimentDir, `${current.experiment!.experimentId}.json`), `${JSON.stringify(conflict, null, 2)}\n`, "utf8");
    const outcome = persistN2EdgeKnowledgeLineage({ repoRoot: root, registryRoot, plan: current, writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT });
    assert.equal(outcome.status, "BLOCKED");
    assert.ok(outcome.blockers.some((blocker) => blocker.includes("EXPERIMENTS_REGISTRY_CONFLICT")));
    assert.equal(outcome.discovery.appended, false);
    assert.equal(readdirSync(registryRoot).includes("discoveries"), false);
  });
});

test("conflicting existing Discovery blocks preflight before Experiment is appended", () => {
  withRoot((root, registryRoot) => {
    const current = plan();
    const discoveryDir = join(registryRoot, "discoveries");
    mkdirSync(discoveryDir, { recursive: true });
    const conflict = { ...current.discoveryCandidate!, finding: "tampered finding" };
    writeFileSync(join(discoveryDir, `${current.discoveryCandidate!.discoveryId}.json`), `${JSON.stringify(conflict, null, 2)}\n`, "utf8");
    const outcome = persistN2EdgeKnowledgeLineage({ repoRoot: root, registryRoot, plan: current, writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT });
    assert.equal(outcome.status, "BLOCKED");
    assert.ok(outcome.blockers.some((blocker) => blocker.includes("DISCOVERIES_REGISTRY_CONFLICT")));
    assert.equal(readdirSync(registryRoot).includes("experiments"), false);
  });
});

test("explicit reviewed write intent and zero execution authority are mandatory", () => {
  withRoot((root, registryRoot) => {
    const current = plan();
    const invalidIntent = persistN2EdgeKnowledgeLineage({
      repoRoot: root,
      registryRoot,
      plan: current,
      writeIntent: "INVALID" as typeof N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT,
    });
    assert.equal(invalidIntent.status, "BLOCKED");
    assert.ok(invalidIntent.blockers.includes("WRITE_INTENT_INVALID"));

    const tampered = {
      ...current,
      authority: { ...current.authority, currentBuyConnectionAuthorized: true as never },
    };
    const authority = persistN2EdgeKnowledgeLineage({
      repoRoot: root,
      registryRoot,
      plan: tampered,
      writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT,
    });
    assert.equal(authority.status, "BLOCKED");
    assert.ok(authority.blockers.includes("LINEAGE_PLAN_EXECUTION_AUTHORITY_INVALID"));
  });
});
