import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "./canonical";
import type { N2EdgeHoldoutDistributionEvidenceReport } from "./n2EdgeHoldoutDistributionEvidence";
import { evaluateN2EdgeHoldoutConcentration } from "./n2EdgeHoldoutConcentrationPolicy";

function reportWithValidationGeometry(input: {
  distinctVenueCount: number;
  maxVenueRaceCount: number;
  distinctYearCount: number;
  maxYearRaceCount: number;
}): N2EdgeHoldoutDistributionEvidenceReport {
  const validation = {
    split: "validation" as const,
    uniqueRaceCount: 220,
    distinctVenueCount: input.distinctVenueCount,
    maxVenueRaceCount: input.maxVenueRaceCount,
    maxVenueShare: input.maxVenueRaceCount / 220,
    distinctYearCount: input.distinctYearCount,
    maxYearRaceCount: input.maxYearRaceCount,
    maxYearShare: input.maxYearRaceCount / 220,
  };
  const testSplit = {
    split: "test" as const,
    uniqueRaceCount: 220,
    distinctVenueCount: 17,
    maxVenueRaceCount: 14,
    maxVenueShare: 14 / 220,
    distinctYearCount: 2,
    maxYearRaceCount: 120,
    maxYearShare: 120 / 220,
  };
  const core = {
    evidenceVersion: "n2-edge-holdout-distribution-evidence-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    lockedHypothesisCount: 1,
    inputRaceCount: 440,
    validationInputRaceCount: 220,
    testInputRaceCount: 220,
    hypotheses: [{ hypothesisId: "N2EDGE-geometry-fixture", validation, test: testSplit }],
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

test("impossible venue and year maxima cannot masquerade as low concentration", () => {
  const report = evaluateN2EdgeHoldoutConcentration(reportWithValidationGeometry({
    distinctVenueCount: 24,
    maxVenueRaceCount: 1,
    distinctYearCount: 2,
    maxYearRaceCount: 1,
  }));

  assert.equal(report.status, "PASS");
  assert.equal(report.hypotheses[0].status, "BLOCKED");
  assert.ok(report.hypotheses[0].validation.blockers.includes("MAX_VENUE_RACE_COUNT_TOO_SMALL_FOR_SUPPORT"));
  assert.ok(report.hypotheses[0].validation.blockers.includes("MAX_YEAR_RACE_COUNT_TOO_SMALL_FOR_SUPPORT"));
});

test("declared distinct years must retain at least one support race each", () => {
  const report = evaluateN2EdgeHoldoutConcentration(reportWithValidationGeometry({
    distinctVenueCount: 17,
    maxVenueRaceCount: 14,
    distinctYearCount: 2,
    maxYearRaceCount: 220,
  }));

  assert.equal(report.status, "PASS");
  assert.equal(report.hypotheses[0].status, "BLOCKED");
  assert.ok(report.hypotheses[0].validation.blockers.includes(
    "MAX_YEAR_RACE_COUNT_LEAVES_NO_SUPPORT_FOR_DISTINCT_YEARS",
  ));
});

test("mathematically possible concentration geometry remains accepted", () => {
  const report = evaluateN2EdgeHoldoutConcentration(reportWithValidationGeometry({
    distinctVenueCount: 17,
    maxVenueRaceCount: 14,
    distinctYearCount: 2,
    maxYearRaceCount: 120,
  }));

  assert.equal(report.status, "PASS");
  assert.equal(report.hypotheses[0].status, "PASS");
  assert.deepEqual(report.hypotheses[0].validation.blockers, []);
});
