import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
import type {
  N2EdgeHistoricalConfirmationReport,
  N2EdgeHistoricalConfirmationResult,
} from "../research-replay/n2EdgeHistoricalConfirmation";
import {
  createN2ConfounderAuditExecutor,
  readN2HistoricalTestArtifact,
} from "./n2ConfounderAuditExecutor";
import type { ExecutorContext } from "./taskExecutors";

function splitResult(split: "validation" | "test", meanResidual = 0.02) {
  return {
    split,
    uniqueRaceCount: 220,
    meanResidual,
    standardError: 0.002,
    zScore: meanResidual / 0.002,
    rawPValue: 1e-8,
    holmAdjustedPValue: 1e-8,
    supportSufficient: true,
    effectSufficient: true,
    directionMatchesDiscovery: true,
    statisticallyConfirmed: true,
  };
}

function result(
  hypothesisId: string,
  verdict: N2EdgeHistoricalConfirmationResult["verdict"],
): N2EdgeHistoricalConfirmationResult {
  return {
    hypothesisId,
    featureKey: "firstCourse",
    bucket: "1",
    discoveryDirection: "underpredicted",
    validation: splitResult("validation"),
    test: splitResult("test"),
    verdict,
  };
}

function confirmation(results: N2EdgeHistoricalConfirmationResult[]): N2EdgeHistoricalConfirmationReport {
  const core = {
    confirmationVersion: "n2-edge-historical-confirmation-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    lockedHypothesisCount: results.length,
    validationRaceCount: 220,
    testRaceCount: 220,
    confirmationMethod: {
      rediscoveryAllowed: false as const,
      interactionSearchAllowed: false as const,
      raceLevelResidualRequired: true as const,
      minUniqueRacesPerSplit: 200,
      minAbsoluteResidual: 0.001,
      familyWiseAlpha: 0.05,
      multipleTesting: "Holm-Bonferroni separately within validation and test" as const,
      bothHoldoutSplitsRequired: true as const,
      sameDirectionRequired: true as const,
      forwardShadowUsed: false as const,
    },
    confirmedCount: results.filter((item) => item.verdict === "HISTORICAL_CONFIRMED").length,
    rejectedCount: results.filter((item) => item.verdict === "HISTORICAL_REJECTED").length,
    insufficientCount: results.filter((item) => item.verdict === "INSUFFICIENT_HOLDOUT").length,
    results,
    authority: {
      roiUsedForConfirmation: false as const,
      payoutUsedForConfirmation: false as const,
      trainLabelsUsedForConfirmation: false as const,
      forwardLabelsUsedForConfirmation: false as const,
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function writeHistoricalArtifact(
  root: string,
  results: N2EdgeHistoricalConfirmationResult[],
  overrides: Record<string, unknown> = {},
): string {
  const reports = join(root, "reports/n2");
  mkdirSync(reports, { recursive: true });
  const payload = {
    status: "PASS",
    generatedAt: "2026-08-08T07:00:00.000Z",
    outputDigest: canonicalHash({ source: "n2-041-fixture", results }),
    confirmation: confirmation(results),
    authority: {
      automaticPromotionAuthorized: false,
      productionApplyAuthorized: false,
    },
    ...overrides,
  };
  writeFileSync(join(reports, "n2-edge-historical-test.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload.outputDigest;
}

function context(root: string, status = "PASS"): ExecutorContext {
  return {
    repoRoot: root,
    runId: "run-n2-042-test",
    requestId: "REQ-n2-042-test",
    taskId: "TASK-N2-042",
    sidecarPath: join(root, "data/research-replay.sqlite"),
    historyDir: join(root, "reports/automation/history"),
    reportsDir: join(root, "reports/n2"),
    dryRun: false,
    taskStatuses: { "TASK-N2-041": status },
  };
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-confounder-audit-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("dependency is checked before reading N2-041 artifact", () => {
  withRoot((root) => {
    const executor = createN2ConfounderAuditExecutor();
    const outcome = executor(context(root, "BLOCKED"));
    assert.equal(outcome.result, "BLOCKED");
    assert.ok(outcome.blocks.some((blocker) => blocker.includes("DEPENDENCY_NOT_SATISFIED:TASK-N2-041")));
    assert.equal(existsSync(join(root, "reports/n2/n2-confounder-audit.json")), false);
  });
});

test("executor appends only rejected hypotheses, blocks confirmed promotion, and exposes durable registry output", () => {
  withRoot((root) => {
    const results = [
      result("H-REJECT", "HISTORICAL_REJECTED"),
      result("H-INSUFFICIENT", "INSUFFICIENT_HOLDOUT"),
      result("H-CONFIRMED", "HISTORICAL_CONFIRMED"),
    ];
    writeHistoricalArtifact(root, results);
    const executor = createN2ConfounderAuditExecutor();
    const first = executor(context(root));
    assert.equal(first.result, "PASS");
    assert.equal(first.outputs[0], "reports/n2/n2-confounder-audit.json");
    assert.equal(first.outputs.length, 2);
    assert.match(first.outputs[1], /^research\/registries\/rejections\/REJ-N2-[0-9a-f]{12}-[0-9a-f]{12}\.json$/u);

    const registryDir = join(root, "research/registries/rejections");
    const files = readdirSync(registryDir).filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 1);
    const rejection = JSON.parse(readFileSync(join(registryDir, files[0]), "utf8")) as Record<string, unknown>;
    assert.equal(rejection.subjectId, "H-REJECT");
    assert.equal(rejection.subjectType, "discovery");
    assert.equal(rejection.evidenceStage, "holdout");
    assert.match(String(rejection.rejectionId), /^REJ-N2-[0-9a-f]{12}-[0-9a-f]{12}$/u);

    const report = JSON.parse(readFileSync(join(root, "reports/n2/n2-confounder-audit.json"), "utf8")) as any;
    assert.equal(report.rejectedCount, 1);
    assert.equal(report.insufficientCount, 1);
    assert.equal(report.confirmedBlockedCount, 1);
    const confirmed = report.audit.items.find((item: any) => item.hypothesisId === "H-CONFIRMED");
    assert.equal(confirmed.disposition, "CONFIRMED_WITH_BLOCKING_CONFOUNDER");
    assert.equal(confirmed.promotionAuthorized, false);
    assert.equal(confirmed.confounderFlags[0].flagId, "distribution-concentration-evidence-missing-v1");
    assert.equal(report.confounderCoverage.confirmedHypothesisPromotionBlockedUntilDistributionAudit, true);
    assert.equal(report.confounderCoverage.rejectedHypothesisRescueAllowed, false);

    const second = executor({ ...context(root), runId: "run-n2-042-retry" });
    assert.equal(second.result, "PASS");
    assert.equal(second.outputs.length, 2);
    assert.equal(readdirSync(registryDir).filter((name) => name.endsWith(".json")).length, 1);
  });
});

test("conflicting append-only rejection body fails closed before any rewrite", () => {
  withRoot((root) => {
    writeHistoricalArtifact(root, [result("H-REJECT", "HISTORICAL_REJECTED")]);
    const executor = createN2ConfounderAuditExecutor();
    const first = executor(context(root));
    assert.equal(first.result, "PASS");
    const registryDir = join(root, "research/registries/rejections");
    const file = readdirSync(registryDir).find((name) => name.endsWith(".json"));
    assert.ok(file);
    const path = join(registryDir, file);
    const stored = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    stored.reason = "tampered reason";
    writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, "utf8");

    const second = executor({ ...context(root), runId: "run-n2-042-conflict" });
    assert.equal(second.result, "BLOCKED");
    assert.ok(second.blocks.some((blocker) => blocker.includes("REJECTION_REGISTRY_CONFLICT")));
  });
});

test("malformed append-only registry blocks cleanly instead of crashing runner", () => {
  withRoot((root) => {
    writeHistoricalArtifact(root, [result("H-REJECT", "HISTORICAL_REJECTED")]);
    const registryDir = join(root, "research/registries/rejections");
    mkdirSync(registryDir, { recursive: true });
    writeFileSync(join(registryDir, "broken.json"), "{not-json", "utf8");
    const executor = createN2ConfounderAuditExecutor();
    const outcome = executor(context(root));
    assert.equal(outcome.result, "BLOCKED");
    assert.ok(outcome.blocks.some((blocker) => blocker.includes("REJECTION_REGISTRY_READ_FAILED")));
    assert.equal(existsSync(join(root, "reports/n2/n2-confounder-audit.json")), false);
  });
});

test("artifact with tampered confirmation, forward-label or promotion authority fails closed", () => {
  withRoot((root) => {
    const base = confirmation([result("H-CONFIRMED", "HISTORICAL_CONFIRMED")]);
    const badConfirmation = {
      ...base,
      authority: { ...base.authority, forwardLabelsUsedForConfirmation: true },
    };
    writeHistoricalArtifact(root, [result("H-CONFIRMED", "HISTORICAL_CONFIRMED")], {
      confirmation: badConfirmation,
      authority: { automaticPromotionAuthorized: true, productionApplyAuthorized: false },
    });
    const read = readN2HistoricalTestArtifact(root);
    assert.equal(read.artifact, null);
    assert.ok(read.blockers.includes("HISTORICAL_CONFIRMATION_DIGEST_MISMATCH"));
    assert.ok(read.blockers.includes("FORWARD_LABEL_AUTHORITY_INVALID"));
    assert.ok(read.blockers.includes("HISTORICAL_REPORT_PROMOTION_AUTHORITY_INVALID"));
  });
});
