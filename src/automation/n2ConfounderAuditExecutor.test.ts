import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
import { contractDigest, type Rejection } from "../research/governance/contracts";
import {
  createN2ConfounderAuditExecutor,
  preflightN2RejectionRegistry,
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

function validDiscoveryRejection(overrides: Partial<Rejection> = {}): Rejection {
  return {
    rejectionId: "REJ-N2-valid-subject",
    subjectType: "discovery",
    subjectId: "DISC-valid-subject",
    reason: "fixture rejection",
    evidenceStage: "holdout",
    trialFamilyId: "N2-EDGE-V1",
    createdAt: "2026-08-08T07:00:00.000Z",
    ...overrides,
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

test("executor fails closed before appending hypothesis IDs as discovery rejections", () => {
  withRoot((root) => {
    const results = [
      result("H-REJECT", "HISTORICAL_REJECTED"),
      result("H-INSUFFICIENT", "INSUFFICIENT_HOLDOUT"),
      result("H-CONFIRMED", "HISTORICAL_CONFIRMED"),
    ];
    writeHistoricalArtifact(root, results);
    const executor = createN2ConfounderAuditExecutor();
    const outcome = executor(context(root));
    assert.equal(outcome.result, "BLOCKED");
    assert.ok(outcome.blocks.some((blocker) => blocker.includes("REJECTION_SUBJECT_ID_MISMATCH") && blocker.includes(":discovery:H-REJECT")));
    assert.equal(existsSync(join(root, "reports/n2/n2-confounder-audit.json")), false);
    assert.equal(existsSync(join(root, "research")), false, "invalid subject identity must block before registry side effects");
  });
});

test("well-typed discovery rejection keeps append-only conflict detection", () => {
  withRoot((root) => {
    const registryRoot = join(root, "research/registries");
    const planned = validDiscoveryRejection();
    const first = preflightN2RejectionRegistry(registryRoot, [planned]);
    assert.equal(first.ok, true);

    const registryDir = join(registryRoot, "rejections");
    mkdirSync(registryDir, { recursive: true });
    const conflictingBody = { ...planned, reason: "different immutable reason" } as Record<string, unknown>;
    writeFileSync(join(registryDir, `${planned.rejectionId}.json`), `${JSON.stringify({
      ...conflictingBody,
      _digestVersion: "canonical-v2",
      _digest: contractDigest(conflictingBody),
      _recordedAt: "2026-08-08T07:01:00.000Z",
    }, null, 2)}\n`, "utf8");

    const second = preflightN2RejectionRegistry(registryRoot, [planned]);
    assert.equal(second.ok, false);
    assert.ok(second.blockers.some((blocker) => blocker.includes("REJECTION_REGISTRY_CONFLICT")));
  });
});

test("malformed append-only registry blocks cleanly for a well-typed planned subject", () => {
  withRoot((root) => {
    const registryRoot = join(root, "research/registries");
    const registryDir = join(registryRoot, "rejections");
    mkdirSync(registryDir, { recursive: true });
    writeFileSync(join(registryDir, "broken.json"), "{not-json", "utf8");
    const outcome = preflightN2RejectionRegistry(registryRoot, [validDiscoveryRejection()]);
    assert.equal(outcome.ok, false);
    assert.ok(outcome.blockers.some((blocker) => blocker.includes("REJECTION_REGISTRY_READ_FAILED")));
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
