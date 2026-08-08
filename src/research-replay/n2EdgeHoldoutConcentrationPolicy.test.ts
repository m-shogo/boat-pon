import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "./canonical";
import type {
  N2EdgeHoldoutDistributionEvidenceReport,
  N2EdgeHoldoutDistributionSplitEvidence,
} from "./n2EdgeHoldoutDistributionEvidence";
import {
  N2_EDGE_HOLDOUT_MAX_VENUE_SHARE,
  N2_EDGE_HOLDOUT_MAX_YEAR_SHARE,
  N2_EDGE_HOLDOUT_MIN_DISTINCT_VENUES,
  N2_EDGE_HOLDOUT_MIN_DISTINCT_YEARS,
  evaluateN2EdgeHoldoutConcentration,
} from "./n2EdgeHoldoutConcentrationPolicy";

function split(
  splitName: "validation" | "test",
  overrides: Partial<N2EdgeHoldoutDistributionSplitEvidence> = {},
): N2EdgeHoldoutDistributionSplitEvidence {
  return {
    split: splitName,
    uniqueRaceCount: 220,
    distinctVenueCount: 17,
    maxVenueRaceCount: 14,
    maxVenueShare: 14 / 220,
    distinctYearCount: 2,
    maxYearRaceCount: 120,
    maxYearShare: 120 / 220,
    ...overrides,
  };
}

function evidence(
  validation: N2EdgeHoldoutDistributionSplitEvidence = split("validation"),
  testSplit: N2EdgeHoldoutDistributionSplitEvidence = split("test"),
): N2EdgeHoldoutDistributionEvidenceReport {
  const core = {
    evidenceVersion: "n2-edge-holdout-distribution-evidence-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    lockedHypothesisCount: 1,
    inputRaceCount: 440,
    validationInputRaceCount: 220,
    testInputRaceCount: 220,
    hypotheses: [{ hypothesisId: "H-A", validation, test: testSplit }],
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

test("well-distributed two-era evidence passes without authorizing promotion", () => {
  const report = evaluateN2EdgeHoldoutConcentration(evidence());
  assert.equal(report.status, "PASS");
  assert.equal(report.passedHypothesisCount, 1);
  assert.equal(report.blockedHypothesisCount, 0);
  assert.equal(report.insufficientHypothesisCount, 0);
  assert.equal(report.hypotheses[0].status, "PASS");
  assert.equal(report.thresholds.minDistinctVenuesPerSplit, 12);
  assert.equal(report.thresholds.maxVenueSharePerSplit, 0.12);
  assert.equal(report.thresholds.minDistinctYearsPerSplit, 2);
  assert.equal(report.thresholds.maxYearSharePerSplit, 0.75);
  assert.equal(report.authority.automaticPromotionAuthorized, false);
  assert.equal(report.authority.rejectedHypothesisRescueAuthorized, false);
});

test("venue breadth and concentration block independently of confirmation result", () => {
  const report = evaluateN2EdgeHoldoutConcentration(evidence(
    split("validation", {
      distinctVenueCount: N2_EDGE_HOLDOUT_MIN_DISTINCT_VENUES - 1,
      maxVenueRaceCount: 30,
      maxVenueShare: N2_EDGE_HOLDOUT_MAX_VENUE_SHARE + 0.01,
    }),
  ));
  assert.equal(report.status, "PASS");
  assert.equal(report.hypotheses[0].status, "BLOCKED");
  assert.ok(report.hypotheses[0].blockers.some((blocker) => blocker.startsWith("validation:VENUE_BREADTH:")));
  assert.ok(report.hypotheses[0].blockers.some((blocker) => blocker.startsWith("validation:VENUE_CONCENTRATION:")));
});

test("single-era or dominant-era evidence blocks", () => {
  const report = evaluateN2EdgeHoldoutConcentration(evidence(
    split("validation", {
      distinctYearCount: N2_EDGE_HOLDOUT_MIN_DISTINCT_YEARS - 1,
      maxYearRaceCount: 180,
      maxYearShare: N2_EDGE_HOLDOUT_MAX_YEAR_SHARE + 0.01,
    }),
  ));
  assert.equal(report.hypotheses[0].status, "BLOCKED");
  assert.ok(report.hypotheses[0].blockers.some((blocker) => blocker.startsWith("validation:YEAR_BREADTH:")));
  assert.ok(report.hypotheses[0].blockers.some((blocker) => blocker.startsWith("validation:YEAR_CONCENTRATION:")));
});

test("support below 200 is insufficient rather than a confounder rejection", () => {
  const report = evaluateN2EdgeHoldoutConcentration(evidence(
    split("validation", {
      uniqueRaceCount: 199,
      distinctVenueCount: 17,
      maxVenueRaceCount: 12,
      maxVenueShare: 12 / 199,
      distinctYearCount: 2,
      maxYearRaceCount: 110,
      maxYearShare: 110 / 199,
    }),
  ));
  assert.equal(report.hypotheses[0].status, "INSUFFICIENT_EVIDENCE");
  assert.ok(report.hypotheses[0].blockers.includes("validation:UNIQUE_RACE_SUPPORT:199/200"));
  assert.equal(report.blockedHypothesisCount, 0);
  assert.equal(report.insufficientHypothesisCount, 1);
});

test("malformed or authority-bearing evidence fails the whole policy report closed", () => {
  const badShare = evaluateN2EdgeHoldoutConcentration(evidence(
    split("validation", { maxVenueShare: 1.1 }),
  ));
  assert.equal(badShare.status, "PASS");
  assert.equal(badShare.hypotheses[0].status, "BLOCKED");
  assert.ok(badShare.hypotheses[0].validation.blockers.includes("MAX_VENUE_SHARE_INVALID"));

  const base = evidence();
  const badAuthority: N2EdgeHoldoutDistributionEvidenceReport = {
    ...base,
    authority: { ...base.authority, automaticPromotionAuthorized: true as never },
  };
  const authorityReport = evaluateN2EdgeHoldoutConcentration(badAuthority);
  assert.equal(authorityReport.status, "BLOCKED");
  assert.ok(authorityReport.blockers.includes("DISTRIBUTION_EVIDENCE_AUTHORITY_INVALID"));
  assert.equal(authorityReport.hypothesisCount, 0);
});

test("policy output is deterministic under hypothesis input reordering", () => {
  const first = evidence();
  const secondCore = {
    ...first,
    lockedHypothesisCount: 2,
    hypotheses: [
      { hypothesisId: "H-B", validation: split("validation"), test: split("test") },
      ...first.hypotheses,
    ],
  };
  const { outputDigest: _ignored, ...withoutDigest } = secondCore;
  const second = { ...withoutDigest, outputDigest: canonicalHash(withoutDigest) } as N2EdgeHoldoutDistributionEvidenceReport;
  const a = evaluateN2EdgeHoldoutConcentration(second);
  const bInput = { ...second, hypotheses: [...second.hypotheses].reverse() };
  const b = evaluateN2EdgeHoldoutConcentration(bInput);
  assert.equal(a.outputDigest, b.outputDigest);
  assert.deepEqual(a.hypotheses, b.hypotheses);
});
