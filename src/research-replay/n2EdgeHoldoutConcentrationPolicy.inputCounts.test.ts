import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "./canonical";
import type { N2EdgeHoldoutDistributionEvidenceReport } from "./n2EdgeHoldoutDistributionEvidence";
import { evaluateN2EdgeHoldoutConcentration } from "./n2EdgeHoldoutConcentrationPolicy";

function evidence(overrides: Partial<Pick<
  N2EdgeHoldoutDistributionEvidenceReport,
  "inputRaceCount" | "validationInputRaceCount" | "testInputRaceCount"
>> = {}): N2EdgeHoldoutDistributionEvidenceReport {
  const core = {
    evidenceVersion: "n2-edge-holdout-distribution-evidence-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    lockedHypothesisCount: 1,
    inputRaceCount: 440,
    validationInputRaceCount: 220,
    testInputRaceCount: 220,
    hypotheses: [{
      hypothesisId: "N2EDGE-input-count-fixture",
      validation: {
        split: "validation" as const,
        uniqueRaceCount: 220,
        distinctVenueCount: 24,
        maxVenueRaceCount: 20,
        maxVenueShare: 20 / 220,
        distinctYearCount: 2,
        maxYearRaceCount: 110,
        maxYearShare: 110 / 220,
      },
      test: {
        split: "test" as const,
        uniqueRaceCount: 220,
        distinctVenueCount: 24,
        maxVenueRaceCount: 20,
        maxVenueShare: 20 / 220,
        distinctYearCount: 2,
        maxYearRaceCount: 110,
        maxYearShare: 110 / 220,
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
    ...overrides,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

test("distribution support cannot exceed the persisted split input count", () => {
  const report = evaluateN2EdgeHoldoutConcentration(evidence({
    inputRaceCount: 20,
    validationInputRaceCount: 10,
    testInputRaceCount: 10,
  }));

  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes(
    "DISTRIBUTION_EVIDENCE_VALIDATION_SUPPORT_EXCEEDS_INPUT:N2EDGE-input-count-fixture:220/10",
  ));
  assert.ok(report.blockers.includes(
    "DISTRIBUTION_EVIDENCE_TEST_SUPPORT_EXCEEDS_INPUT:N2EDGE-input-count-fixture:220/10",
  ));
  assert.deepEqual(report.hypotheses, []);
});

test("distribution input counts must be non-negative safe integers", () => {
  const report = evaluateN2EdgeHoldoutConcentration(evidence({
    inputRaceCount: 439.5,
    validationInputRaceCount: 219.5,
    testInputRaceCount: 220,
  }));

  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("DISTRIBUTION_EVIDENCE_INPUT_COUNT_INVALID"));
  assert.deepEqual(report.hypotheses, []);
});

test("canonical distribution input and support counts remain accepted", () => {
  const report = evaluateN2EdgeHoldoutConcentration(evidence());

  assert.equal(report.status, "PASS");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.hypotheses.length, 1);
  assert.equal(report.hypotheses[0].status, "PASS");
});
