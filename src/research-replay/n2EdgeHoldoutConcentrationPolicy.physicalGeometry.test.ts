import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "./canonical";
import type {
  N2EdgeHoldoutDistributionEvidenceReport,
  N2EdgeHoldoutDistributionSplitEvidence,
} from "./n2EdgeHoldoutDistributionEvidence";
import {
  N2_EDGE_HOLDOUT_MAX_RACES_PER_VENUE,
  N2_EDGE_HOLDOUT_MAX_RACES_PER_YEAR,
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

function evidence(validation: N2EdgeHoldoutDistributionSplitEvidence): N2EdgeHoldoutDistributionEvidenceReport {
  const core = {
    evidenceVersion: "n2-edge-holdout-distribution-evidence-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    lockedHypothesisCount: 1,
    inputRaceCount: 440,
    validationInputRaceCount: 220,
    testInputRaceCount: 220,
    hypotheses: [{ hypothesisId: "H-A", validation, test: split("test") }],
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

test("rehashing cannot exceed the frozen per-venue holdout capacity", () => {
  const impossible = N2_EDGE_HOLDOUT_MAX_RACES_PER_VENUE + 1;
  const report = evaluateN2EdgeHoldoutConcentration(evidence(split("validation", {
    uniqueRaceCount: 220,
    distinctVenueCount: 12,
    maxVenueRaceCount: impossible,
    maxVenueShare: impossible / 220,
    distinctYearCount: 2,
    maxYearRaceCount: 120,
    maxYearShare: 120 / 220,
  })));

  assert.equal(report.status, "PASS");
  assert.equal(report.hypotheses[0].status, "BLOCKED");
  assert.ok(report.hypotheses[0].validation.blockers.includes(
    `MAX_VENUE_RACE_COUNT_EXCEEDS_HOLDOUT:${impossible}/${N2_EDGE_HOLDOUT_MAX_RACES_PER_VENUE}`,
  ));
});

test("rehashing cannot exceed the frozen per-year holdout capacity", () => {
  const impossible = N2_EDGE_HOLDOUT_MAX_RACES_PER_YEAR + 1;
  const total = impossible + 100;
  const validation = split("validation", {
    uniqueRaceCount: total,
    distinctVenueCount: 24,
    maxVenueRaceCount: Math.ceil(total / 24),
    maxVenueShare: Math.ceil(total / 24) / total,
    distinctYearCount: 2,
    maxYearRaceCount: impossible,
    maxYearShare: impossible / total,
  });
  const base = evidence(validation);
  const core = {
    ...base,
    inputRaceCount: total + 220,
    validationInputRaceCount: total,
    hypotheses: [{ hypothesisId: "H-A", validation, test: split("test") }],
  };
  const { outputDigest: _ignored, ...withoutDigest } = core;
  const report = evaluateN2EdgeHoldoutConcentration({ ...withoutDigest, outputDigest: canonicalHash(withoutDigest) });

  assert.equal(report.status, "PASS");
  assert.equal(report.hypotheses[0].status, "BLOCKED");
  assert.ok(report.hypotheses[0].validation.blockers.includes(
    `MAX_YEAR_RACE_COUNT_EXCEEDS_HOLDOUT:${impossible}/${N2_EDGE_HOLDOUT_MAX_RACES_PER_YEAR}`,
  ));
});

test("rehashing cannot claim a year with more races than its distinct venues can host", () => {
  const validation = split("validation", {
    uniqueRaceCount: 200,
    distinctVenueCount: 12,
    maxVenueRaceCount: 17,
    maxVenueShare: 17 / 200,
    distinctYearCount: 2,
    maxYearRaceCount: 150,
    maxYearShare: 150 / 200,
  });
  const base = evidence(validation);
  const core = {
    ...base,
    inputRaceCount: 420,
    validationInputRaceCount: 200,
    hypotheses: [{ hypothesisId: "H-A", validation, test: split("test") }],
  };
  const { outputDigest: _ignored, ...withoutDigest } = core;
  const report = evaluateN2EdgeHoldoutConcentration({ ...withoutDigest, outputDigest: canonicalHash(withoutDigest) });

  assert.equal(report.status, "PASS");
  assert.equal(report.hypotheses[0].status, "BLOCKED");
  assert.ok(report.hypotheses[0].validation.blockers.includes("MAX_YEAR_RACE_COUNT_EXCEEDS_VENUE_CAPACITY"));
});
