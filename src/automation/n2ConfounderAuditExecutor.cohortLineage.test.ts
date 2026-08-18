import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
import type { N2EdgeHistoricalConfirmationReport } from "../research-replay/n2EdgeHistoricalConfirmation";
import { N2_EDGE_HOLDOUT_MAX_RACES_PER_SPLIT } from "../research-replay/n2EdgeHoldoutCohort";
import type { N2EdgeHoldoutDistributionEvidenceReport } from "../research-replay/n2EdgeHoldoutDistributionEvidence";
import { readN2HistoricalTestArtifact } from "./n2ConfounderAuditExecutor";
import {
  N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION,
  N2_EDGE_HISTORICAL_TEST_REPORT_VERSION,
} from "./n2EdgeHistoricalTestExecutor";

const HYPOTHESIS_ID = "DISC-cohort-lineage";

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

function confirmation(totalPerSplit: number, supportPerSplit: number): N2EdgeHistoricalConfirmationReport {
  const split = (name: "validation" | "test") => ({
    split: name,
    uniqueRaceCount: supportPerSplit,
    meanResidual: 0.02,
    standardError: 0,
    zScore: null,
    rawPValue: 0,
    holmAdjustedPValue: 0,
    supportSufficient: true,
    effectSufficient: true,
    directionMatchesDiscovery: true,
    statisticallyConfirmed: true,
  });
  const result = {
    hypothesisId: HYPOTHESIS_ID,
    featureKey: "firstCourse",
    bucket: "1",
    discoveryDirection: "underpredicted" as const,
    validation: split("validation"),
    test: split("test"),
    verdict: "HISTORICAL_CONFIRMED" as const,
  };
  const core = {
    confirmationVersion: "n2-edge-historical-confirmation-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    lockedHypothesisCount: 1,
    validationRaceCount: totalPerSplit,
    testRaceCount: totalPerSplit,
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
    confirmedCount: 1,
    rejectedCount: 0,
    insufficientCount: 0,
    results: [result],
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

function distribution(totalPerSplit: number, supportPerSplit: number): N2EdgeHoldoutDistributionEvidenceReport {
  const split = (name: "validation" | "test") => ({
    split: name,
    uniqueRaceCount: supportPerSplit,
    distinctVenueCount: 17,
    maxVenueRaceCount: Math.ceil(supportPerSplit / 17),
    maxVenueShare: Math.ceil(supportPerSplit / 17) / supportPerSplit,
    distinctYearCount: 2,
    maxYearRaceCount: Math.ceil(supportPerSplit / 2),
    maxYearShare: Math.ceil(supportPerSplit / 2) / supportPerSplit,
  });
  const core = {
    evidenceVersion: "n2-edge-holdout-distribution-evidence-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    lockedHypothesisCount: 1,
    inputRaceCount: totalPerSplit * 2,
    validationInputRaceCount: totalPerSplit,
    testInputRaceCount: totalPerSplit,
    hypotheses: [{ hypothesisId: HYPOTHESIS_ID, validation: split("validation"), test: split("test") }],
    privacy: {
      raceKeysPersisted: false as const,
      venueCodesPersisted: false as const,
      yearsPersisted: false as const,
      perRaceResidualsPersisted: false as const,
    },
    authority: {
      confirmationVerdictChanged: false as const,
      rejectionRescueAuthorized: false as const,
      automaticPromotionAuthorized: false as const,
      forwardLabelsUsed: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function writeFixture(
  root: string,
  totalPerSplit: number,
  supportPerSplit: number,
  executorContractVersion: string = N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION,
  reportVersion: string | null = N2_EDGE_HISTORICAL_TEST_REPORT_VERSION,
  databaseWriteCount: number | null = 0,
  networkRequestCount: number | null = 0,
): void {
  const dir = join(root, "reports/n2");
  mkdirSync(dir, { recursive: true });
  const discoverySummary = {
    status: "PASS" as const,
    scan: {
      status: "PASS" as const,
      scanVersion: "n2-edge-hypothesis-scan-v2",
      signals: [{
        hypothesisId: HYPOTHESIS_ID,
        featureKey: "firstCourse",
        bucket: "1",
        direction: "underpredicted" as const,
        discoverySplit: "train" as const,
        forwardShadowReserved: true as const,
      }],
      authority: discoveryAuthority(),
    },
  };
  const discovery = { ...discoverySummary, outputDigest: canonicalHash(discoverySummary) };
  writeFileSync(join(dir, "n2-edge-hypothesis-scan.json"), JSON.stringify(discovery));

  const historicalSummary = {
    ...(reportVersion === null ? {} : { reportVersion }),
    executorContractVersion,
    status: "PASS" as const,
    discoveryArtifactDigest: canonicalHash(discovery),
    cohort: {
      selectedValidationRaceCount: totalPerSplit,
      selectedTestRaceCount: totalPerSplit,
      validationCohortDigest: "a".repeat(64),
      testCohortDigest: "b".repeat(64),
      outputDigest: "c".repeat(64),
    },
    confirmation: confirmation(totalPerSplit, supportPerSplit),
    distributionEvidence: distribution(totalPerSplit, supportPerSplit),
    ...(databaseWriteCount === null ? {} : { databaseWriteCount }),
    ...(networkRequestCount === null ? {} : { networkRequestCount }),
    authority: {
      automaticPromotionAuthorized: false,
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      publicPublishAuthorized: false,
      automatedBettingAuthorized: false,
      productionApplyAuthorized: false,
    },
  };
  writeFileSync(join(dir, "n2-edge-historical-test.json"), JSON.stringify({
    ...historicalSummary,
    generatedAt: "2026-08-17T10:00:00.000Z",
    outputDigest: canonicalHash(historicalSummary),
  }));
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-cohort-lineage-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("canonical historical cohort counts remain readable", () => withRoot((root) => {
  writeFixture(root, 220, 220);
  const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true, requireProducerContract: true });
  assert.deepEqual(read.blockers, []);
  assert.ok(read.artifact);
}));

test("rehashing cannot claim historical database writes", () => withRoot((root) => {
  writeFixture(root, 220, 220, N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION, N2_EDGE_HISTORICAL_TEST_REPORT_VERSION, 1, 0);
  const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true, requireProducerContract: true });
  assert.equal(read.artifact, null);
  assert.ok(read.blockers.includes("HISTORICAL_TEST_DATABASE_WRITE_COUNT_INVALID:1"));
}));

test("rehashing cannot claim historical network requests", () => withRoot((root) => {
  writeFixture(root, 220, 220, N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION, N2_EDGE_HISTORICAL_TEST_REPORT_VERSION, 0, 1);
  const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true, requireProducerContract: true });
  assert.equal(read.artifact, null);
  assert.ok(read.blockers.includes("HISTORICAL_TEST_NETWORK_REQUEST_COUNT_INVALID:1"));
}));

test("producer provenance counts are required", () => withRoot((root) => {
  writeFixture(root, 220, 220, N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION, N2_EDGE_HISTORICAL_TEST_REPORT_VERSION, null, null);
  const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true, requireProducerContract: true });
  assert.equal(read.artifact, null);
  assert.ok(read.blockers.includes("HISTORICAL_TEST_DATABASE_WRITE_COUNT_INVALID:MISSING"));
  assert.ok(read.blockers.includes("HISTORICAL_TEST_NETWORK_REQUEST_COUNT_INVALID:MISSING"));
}));

test("rehashing cannot claim more hypothesis support than the persisted cohort", () => withRoot((root) => {
  writeFixture(root, 10, 220);
  const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true, requireProducerContract: true });
  assert.equal(read.artifact, null);
  assert.ok(read.blockers.includes(`${HYPOTHESIS_ID}:HISTORICAL_VALIDATION_SUPPORT_EXCEEDS_COHORT:220/10`));
  assert.ok(read.blockers.includes(`${HYPOTHESIS_ID}:HISTORICAL_TEST_SUPPORT_EXCEEDS_COHORT:220/10`));
}));

test("rehashing cannot exceed the producer holdout cohort ceiling", () => withRoot((root) => {
  const impossibleCount = N2_EDGE_HOLDOUT_MAX_RACES_PER_SPLIT + 1;
  writeFixture(root, impossibleCount, impossibleCount);
  const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true, requireProducerContract: true });
  assert.equal(read.artifact, null);
  assert.ok(read.blockers.includes(
    `HISTORICAL_COHORT_MAX_RACES_EXCEEDED:${impossibleCount}/${N2_EDGE_HOLDOUT_MAX_RACES_PER_SPLIT}`
      + `:${impossibleCount}/${N2_EDGE_HOLDOUT_MAX_RACES_PER_SPLIT}`,
  ));
}));

test("rehashing cannot replace the historical executor contract", () => withRoot((root) => {
  writeFixture(root, 220, 220, "n2-edge-historical-test-executor-v0");
  const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true, requireProducerContract: true });
  assert.equal(read.artifact, null);
  assert.ok(read.blockers.includes(
    `HISTORICAL_TEST_EXECUTOR_CONTRACT_VERSION_MISMATCH:n2-edge-historical-test-executor-v0/${N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION}`,
  ));
}));

test("rehashing cannot replace the historical report version", () => withRoot((root) => {
  writeFixture(root, 220, 220, N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION, "n2-edge-historical-test-report-v0");
  const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true, requireProducerContract: true });
  assert.equal(read.artifact, null);
  assert.ok(read.blockers.includes(
    `HISTORICAL_TEST_REPORT_VERSION_MISMATCH:n2-edge-historical-test-report-v0/${N2_EDGE_HISTORICAL_TEST_REPORT_VERSION}`,
  ));
}));

test("rehashing cannot omit the historical report version", () => withRoot((root) => {
  writeFixture(root, 220, 220, N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION, null);
  const read = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true, requireProducerContract: true });
  assert.equal(read.artifact, null);
  assert.ok(read.blockers.includes(
    `HISTORICAL_TEST_REPORT_VERSION_MISMATCH:MISSING/${N2_EDGE_HISTORICAL_TEST_REPORT_VERSION}`,
  ));
}));