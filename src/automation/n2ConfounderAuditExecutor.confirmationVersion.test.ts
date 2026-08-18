import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
import { N2_EDGE_HISTORICAL_CONFIRMATION_VERSION } from "../research-replay/n2EdgeHistoricalConfirmation";
import { N2_EDGE_HYPOTHESIS_SCAN_VERSION } from "../research-replay/n2EdgeHypothesisScan";
import { readN2HistoricalTestArtifact } from "./n2ConfounderAuditExecutor";
import {
  N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION,
  N2_EDGE_HISTORICAL_TEST_REPORT_VERSION,
} from "./n2EdgeHistoricalTestExecutor";

function discoveryAuthority() {
  return {
    discoveryOnly: true,
    validationLabelsUsedForDiscovery: false,
    testLabelsUsedForDiscovery: false,
    automaticPromotionAuthorized: false,
    automaticForwardAuthorized: false,
    roiPayoutAccessAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    automatedBettingAuthorized: false,
    productionApplyAuthorized: false,
  };
}

function confirmation(confirmationVersion: string | null) {
  const core = {
    ...(confirmationVersion === null ? {} : { confirmationVersion }),
    status: "PASS" as const,
    blockers: [] as string[],
    lockedHypothesisCount: 0,
    validationRaceCount: 0,
    testRaceCount: 0,
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
    confirmedCount: 0,
    rejectedCount: 0,
    insufficientCount: 0,
    results: [] as unknown[],
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

function writeFixture(root: string, confirmationVersion: string | null): void {
  const reports = join(root, "reports/n2");
  mkdirSync(reports, { recursive: true });
  const discoverySummary = {
    status: "PASS" as const,
    scan: {
      status: "PASS" as const,
      scanVersion: N2_EDGE_HYPOTHESIS_SCAN_VERSION,
      signals: [] as unknown[],
      authority: discoveryAuthority(),
    },
  };
  const discovery = { ...discoverySummary, outputDigest: canonicalHash(discoverySummary) };
  writeFileSync(join(reports, "n2-edge-hypothesis-scan.json"), JSON.stringify(discovery));

  const historicalSummary = {
    reportVersion: N2_EDGE_HISTORICAL_TEST_REPORT_VERSION,
    executorContractVersion: N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION,
    status: "PASS" as const,
    discoveryArtifactDigest: canonicalHash(discovery),
    confirmation: confirmation(confirmationVersion),
    databaseWriteCount: 0,
    networkRequestCount: 0,
    authority: {
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  writeFileSync(join(reports, "n2-edge-historical-test.json"), JSON.stringify({
    ...historicalSummary,
    generatedAt: "2026-08-18T00:00:00.000Z",
    outputDigest: canonicalHash(historicalSummary),
  }));
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-confirmation-version-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("current Historical Confirmation version remains accepted", () => withRoot((root) => {
  writeFixture(root, N2_EDGE_HISTORICAL_CONFIRMATION_VERSION);
  const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true, requireProducerContract: true });
  assert.deepEqual(read.blockers, []);
  assert.notEqual(read.artifact, null);
}));

test("rehashing cannot replace or omit the Historical Confirmation version", () => {
  for (const confirmationVersion of ["n2-edge-historical-confirmation-v0", null]) {
    withRoot((root) => {
      writeFixture(root, confirmationVersion);
      const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true, requireProducerContract: true });
      assert.equal(read.artifact, null);
      assert.ok(read.blockers.includes(
        `HISTORICAL_CONFIRMATION_VERSION_MISMATCH:${confirmationVersion ?? "MISSING"}/${N2_EDGE_HISTORICAL_CONFIRMATION_VERSION}`,
      ));
    });
  }
});