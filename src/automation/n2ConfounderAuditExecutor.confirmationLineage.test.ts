import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
import { readN2HistoricalTestArtifact } from "./n2ConfounderAuditExecutor";

const HYPOTHESIS_ID = "N2EDGE-confirmation-lineage";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-confirmation-lineage-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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

function writeDiscovery(root: string, hypothesisId = HYPOTHESIS_ID): unknown {
  const reports = join(root, "reports/n2");
  mkdirSync(reports, { recursive: true });
  const summary = {
    status: "PASS" as const,
    scan: {
      status: "PASS" as const,
      scanVersion: "n2-edge-hypothesis-scan-v2",
      signals: [{
        hypothesisId,
        featureKey: "firstCourse",
        bucket: "1",
        direction: "underpredicted" as const,
        discoverySplit: "train" as const,
        forwardShadowReserved: true as const,
      }],
      authority: discoveryAuthority(),
    },
  };
  const discovery = { ...summary, outputDigest: canonicalHash(summary) };
  writeFileSync(join(reports, "n2-edge-hypothesis-scan.json"), `${JSON.stringify(discovery, null, 2)}\n`, "utf8");
  return discovery;
}

function split(splitName: "validation" | "test") {
  return {
    split: splitName,
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

function writeHistorical(root: string, discovery: unknown, overrides: {
  hypothesisId?: string;
  featureKey?: string;
  bucket?: string;
  discoveryDirection?: "underpredicted" | "overpredicted";
} = {}): void {
  const result = {
    hypothesisId: overrides.hypothesisId ?? HYPOTHESIS_ID,
    featureKey: overrides.featureKey ?? "firstCourse",
    bucket: overrides.bucket ?? "1",
    discoveryDirection: overrides.discoveryDirection ?? "underpredicted",
    validation: split("validation"),
    test: split("test"),
    verdict: "HISTORICAL_CONFIRMED" as const,
  };
  const confirmationCore = {
    status: "PASS" as const,
    lockedHypothesisCount: 1,
    validationRaceCount: 220,
    testRaceCount: 220,
    confirmedCount: 1,
    rejectedCount: 0,
    insufficientCount: 0,
    results: [result],
    authority: {
      forwardLabelsUsedForConfirmation: false as const,
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  const summary = {
    status: "PASS" as const,
    discoveryArtifactDigest: canonicalHash(discovery),
    cohort: {
      selectedValidationRaceCount: 220,
      selectedTestRaceCount: 220,
    },
    confirmation: { ...confirmationCore, outputDigest: canonicalHash(confirmationCore) },
    authority: {
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  const payload = {
    ...summary,
    generatedAt: "2026-08-17T05:00:00.000Z",
    outputDigest: canonicalHash(summary),
  };
  writeFileSync(join(root, "reports/n2/n2-edge-historical-test.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

test("confounder ingestion accepts confirmation identity matching current discovery", () => {
  withRoot((root) => {
    const discovery = writeDiscovery(root);
    writeHistorical(root, discovery);

    const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true });

    assert.notEqual(read.artifact, null, read.blockers.join("; "));
    assert.deepEqual(read.blockers, []);
  });
});

test("confounder ingestion rejects rehashed confirmation identity drift", () => {
  for (const overrides of [
    { featureKey: "racerClass" },
    { bucket: "2" },
    { discoveryDirection: "overpredicted" as const },
  ]) {
    withRoot((root) => {
      const discovery = writeDiscovery(root);
      writeHistorical(root, discovery, overrides);

      const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true });

      assert.equal(read.artifact, null);
      assert.ok(
        read.blockers.includes(`HISTORICAL_CONFIRMATION_DISCOVERY_IDENTITY_MISMATCH:${HYPOTHESIS_ID}`),
        read.blockers.join("; "),
      );
    });
  }
});

test("confounder ingestion rejects confirmation hypothesis set drift", () => {
  withRoot((root) => {
    const discovery = writeDiscovery(root);
    writeHistorical(root, discovery, { hypothesisId: "N2EDGE-other-lineage" });

    const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true });

    assert.equal(read.artifact, null);
    assert.ok(read.blockers.includes("HISTORICAL_CONFIRMATION_DISCOVERY_SET_MISMATCH"), read.blockers.join("; "));
  });
});
