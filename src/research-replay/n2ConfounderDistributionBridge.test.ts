import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "./canonical";
import type { N2EdgeHistoricalConfirmationResult } from "./n2EdgeHistoricalConfirmation";
import type { N2EdgeHoldoutDistributionEvidenceReport } from "./n2EdgeHoldoutDistributionEvidence";
import { buildN2ConfounderDistributionBridge } from "./n2ConfounderDistributionBridge";

function splitResult(split: "validation" | "test", uniqueRaceCount = 220) {
  return {
    split,
    uniqueRaceCount,
    meanResidual: 0.02,
    standardError: 0.002,
    zScore: 10,
    rawPValue: 1e-8,
    holmAdjustedPValue: 1e-8,
    supportSufficient: uniqueRaceCount >= 200,
    effectSufficient: true,
    directionMatchesDiscovery: true,
    statisticallyConfirmed: uniqueRaceCount >= 200,
  };
}

function confirmation(
  hypothesisId: string,
  verdict: N2EdgeHistoricalConfirmationResult["verdict"] = "HISTORICAL_CONFIRMED",
  validationRaceCount = 220,
  testRaceCount = 220,
): N2EdgeHistoricalConfirmationResult {
  return {
    hypothesisId,
    featureKey: "firstCourse",
    bucket: "1",
    discoveryDirection: "underpredicted",
    validation: splitResult("validation", validationRaceCount),
    test: splitResult("test", testRaceCount),
    verdict,
  };
}

function evidence(input: {
  hypothesisId?: string;
  validationRaceCount?: number;
  testRaceCount?: number;
  validationVenueCount?: number;
  testVenueCount?: number;
  validationMaxVenueRaceCount?: number;
  testMaxVenueRaceCount?: number;
  validationMaxVenueShare?: number;
  testMaxVenueShare?: number;
  validationYearCount?: number;
  testYearCount?: number;
  validationMaxYearRaceCount?: number;
  testMaxYearRaceCount?: number;
  validationMaxYearShare?: number;
  testMaxYearShare?: number;
} = {}): N2EdgeHoldoutDistributionEvidenceReport {
  const hypothesisId = input.hypothesisId ?? "H-A";
  const validationRaceCount = input.validationRaceCount ?? 220;
  const testRaceCount = input.testRaceCount ?? 220;
  const validationMaxVenueRaceCount = input.validationMaxVenueRaceCount ?? 14;
  const testMaxVenueRaceCount = input.testMaxVenueRaceCount ?? 14;
  const validationMaxYearRaceCount = input.validationMaxYearRaceCount ?? 120;
  const testMaxYearRaceCount = input.testMaxYearRaceCount ?? 120;
  const core = {
    evidenceVersion: "n2-edge-holdout-distribution-evidence-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    lockedHypothesisCount: 1,
    inputRaceCount: validationRaceCount + testRaceCount,
    validationInputRaceCount: validationRaceCount,
    testInputRaceCount: testRaceCount,
    hypotheses: [{
      hypothesisId,
      validation: {
        split: "validation" as const,
        uniqueRaceCount: validationRaceCount,
        distinctVenueCount: input.validationVenueCount ?? 17,
        maxVenueRaceCount: validationMaxVenueRaceCount,
        maxVenueShare: input.validationMaxVenueShare ?? validationMaxVenueRaceCount / validationRaceCount,
        distinctYearCount: input.validationYearCount ?? 2,
        maxYearRaceCount: validationMaxYearRaceCount,
        maxYearShare: input.validationMaxYearShare ?? validationMaxYearRaceCount / validationRaceCount,
      },
      test: {
        split: "test" as const,
        uniqueRaceCount: testRaceCount,
        distinctVenueCount: input.testVenueCount ?? 17,
        maxVenueRaceCount: testMaxVenueRaceCount,
        maxVenueShare: input.testMaxVenueShare ?? testMaxVenueRaceCount / testRaceCount,
        distinctYearCount: input.testYearCount ?? 2,
        maxYearRaceCount: testMaxYearRaceCount,
        maxYearShare: input.testMaxYearShare ?? testMaxYearRaceCount / testRaceCount,
      },
    }],
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

test("missing aggregate evidence fails closed before confounder decisions", () => {
  const report = buildN2ConfounderDistributionBridge({
    confirmationResults: [confirmation("H-A")],
    distributionEvidence: null,
  });
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.evidenceMode, "aggregate_distribution_missing");
  assert.ok(report.blockers.includes("DISTRIBUTION_EVIDENCE_REQUIRED_BY_PRODUCER_CONTRACT"));
  assert.equal(report.confirmedBlockedByMissingDistributionCount, 0);
  assert.deepEqual(report.confounderFlags, []);
  assert.equal(report.authority.historicalVerdictChanged, false);
  assert.equal(report.authority.automaticPromotionAuthorized, false);
});

test("well-distributed confirmed hypothesis has no blocking concentration flag but still no promotion authority", () => {
  const report = buildN2ConfounderDistributionBridge({
    confirmationResults: [confirmation("H-A")],
    distributionEvidence: evidence(),
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.policy?.status, "PASS");
  assert.equal(report.confirmedWithoutBlockingConcentrationCount, 1);
  assert.equal(report.confirmedBlockedByConcentrationCount, 0);
  assert.deepEqual(report.confounderFlags, []);
  assert.equal(report.authority.automaticPromotionAuthorized, false);
});

test("pre-registered concentration failure becomes a blocking confounder", () => {
  const maxVenueRaceCount = 20;
  const report = buildN2ConfounderDistributionBridge({
    confirmationResults: [confirmation("H-A")],
    distributionEvidence: evidence({
      validationVenueCount: 11,
      validationMaxVenueRaceCount: maxVenueRaceCount,
      validationMaxVenueShare: maxVenueRaceCount / 220,
    }),
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.confirmedBlockedByConcentrationCount, 1);
  assert.equal(report.confounderFlags.length, 1);
  assert.equal(report.confounderFlags[0].flagId, "holdout-distribution-concentration-v1");
  assert.match(report.confounderFlags[0].detail, /VENUE_BREADTH/u);
});

test("distribution support below 200 blocks as insufficient evidence when confirmation support matches", () => {
  const report = buildN2ConfounderDistributionBridge({
    confirmationResults: [confirmation("H-A", "INSUFFICIENT_HOLDOUT", 199, 220)],
    distributionEvidence: evidence({
      validationRaceCount: 199,
      validationMaxVenueRaceCount: 12,
      validationMaxVenueShare: 12 / 199,
      validationMaxYearRaceCount: 110,
      validationMaxYearShare: 110 / 199,
    }),
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.confirmedBlockedByInsufficientDistributionCount, 0);
  assert.deepEqual(report.confounderFlags, []);
  assert.equal(report.authority.rejectedHypothesisRescueAuthorized, false);
});

test("distribution evidence from a different support cohort fails closed even when hypothesis ids match", () => {
  const report = buildN2ConfounderDistributionBridge({
    confirmationResults: [confirmation("H-A")],
    distributionEvidence: evidence({
      validationRaceCount: 199,
      validationMaxVenueRaceCount: 12,
      validationMaxVenueShare: 12 / 199,
      validationMaxYearRaceCount: 110,
      validationMaxYearShare: 110 / 199,
    }),
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("CONCENTRATION_POLICY_CONFIRMATION_SUPPORT_MISMATCH:H-A:199/220:220/220"));
  assert.deepEqual(report.confounderFlags, []);
});

test("rejected hypotheses are never rescued or decorated into confirmation by distribution evidence", () => {
  const report = buildN2ConfounderDistributionBridge({
    confirmationResults: [confirmation("H-A", "HISTORICAL_REJECTED")],
    distributionEvidence: evidence(),
  });
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.confounderFlags, []);
  assert.equal(report.confirmedWithoutBlockingConcentrationCount, 0);
  assert.equal(report.authority.rejectedHypothesisRescueAuthorized, false);
});

test("hypothesis-set mismatch and malformed evidence fail closed", () => {
  const mismatch = buildN2ConfounderDistributionBridge({
    confirmationResults: [confirmation("H-A")],
    distributionEvidence: evidence({ hypothesisId: "H-B" }),
  });
  assert.equal(mismatch.status, "BLOCKED");
  assert.ok(mismatch.blockers.includes("CONCENTRATION_POLICY_HYPOTHESIS_SET_MISMATCH"));
  assert.deepEqual(mismatch.confounderFlags, []);

  const bad = evidence();
  const malformed: N2EdgeHoldoutDistributionEvidenceReport = {
    ...bad,
    authority: { ...bad.authority, forwardLabelsUsed: true as never },
  };
  const blocked = buildN2ConfounderDistributionBridge({
    confirmationResults: [confirmation("H-A")],
    distributionEvidence: malformed,
  });
  assert.equal(blocked.status, "BLOCKED");
  assert.ok(blocked.blockers.some((item) => item.includes("DISTRIBUTION_EVIDENCE_AUTHORITY_INVALID")));
});
