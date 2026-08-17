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

function rehashEvidence(
  value: Omit<N2EdgeHoldoutDistributionEvidenceReport, "outputDigest">,
): N2EdgeHoldoutDistributionEvidenceReport {
  return { ...value, outputDigest: canonicalHash(value) };
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
  const maxVenueRaceCount = 29;
  const report = evaluateN2EdgeHoldoutConcentration(evidence(
    split("validation", {
      distinctVenueCount: N2_EDGE_HOLDOUT_MIN_DISTINCT_VENUES - 1,
      maxVenueRaceCount,
      maxVenueShare: maxVenueRaceCount / 220,
    }),
  ));
  assert.equal(report.status, "PASS");
  assert.equal(report.hypotheses[0].status, "BLOCKED");
  assert.ok(report.hypotheses[0].blockers.some((blocker) => blocker.startsWith("validation:VENUE_BREADTH:")));
  assert.ok(report.hypotheses[0].blockers.some((blocker) => blocker.startsWith("validation:VENUE_CONCENTRATION:")));
});

test("single-era or dominant-era evidence blocks", () => {
  const maxYearRaceCount = 168;
  const report = evaluateN2EdgeHoldoutConcentration(evidence(
    split("validation", {
      distinctYearCount: N2_EDGE_HOLDOUT_MIN_DISTINCT_YEARS - 1,
      maxYearRaceCount,
      maxYearShare: maxYearRaceCount / 220,
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

test("tampered concentration counts cannot be hidden behind smaller shares", () => {
  const report = evaluateN2EdgeHoldoutConcentration(evidence(
    split("validation", {
      maxVenueRaceCount: 200,
      maxVenueShare: 0.05,
      maxYearRaceCount: 210,
      maxYearShare: 0.55,
    }),
  ));
  assert.equal(report.status, "PASS");
  assert.equal(report.hypotheses[0].status, "BLOCKED");
  assert.ok(report.hypotheses[0].validation.blockers.includes("MAX_VENUE_SHARE_COUNT_MISMATCH"));
  assert.ok(report.hypotheses[0].validation.blockers.includes("MAX_YEAR_SHARE_COUNT_MISMATCH"));
});

test("swapped split labels fail closed instead of silently relabeling evidence", () => {
  const report = evaluateN2EdgeHoldoutConcentration(evidence(
    split("test"),
    split("validation"),
  ));
  assert.equal(report.status, "PASS");
  assert.equal(report.hypotheses[0].status, "BLOCKED");
  assert.ok(report.hypotheses[0].validation.blockers.includes("SPLIT_LABEL_INVALID:test/validation"));
  assert.ok(report.hypotheses[0].test.blockers.includes("SPLIT_LABEL_INVALID:validation/test"));
});

test("stale digest, widened privacy, and inconsistent top-level counts fail closed", () => {
  const base = evidence();
  const staleDigest = {
    ...base,
    inputRaceCount: base.inputRaceCount + 1,
  } as N2EdgeHoldoutDistributionEvidenceReport;
  const staleReport = evaluateN2EdgeHoldoutConcentration(staleDigest);
  assert.equal(staleReport.status, "BLOCKED");
  assert.ok(staleReport.blockers.includes("DISTRIBUTION_EVIDENCE_DIGEST_INVALID"));
  assert.ok(staleReport.blockers.includes("DISTRIBUTION_EVIDENCE_INPUT_COUNT_MISMATCH"));

  const { outputDigest: _ignored, ...baseCore } = base;
  const privacyReport = evaluateN2EdgeHoldoutConcentration(rehashEvidence({
    ...baseCore,
    privacy: { ...base.privacy, raceKeysPersisted: true as never },
  }));
  assert.equal(privacyReport.status, "BLOCKED");
  assert.ok(privacyReport.blockers.includes("DISTRIBUTION_EVIDENCE_PRIVACY_INVALID"));
});

test("malformed or authority-bearing evidence fails the whole policy report closed", () => {
  const badShare = evaluateN2EdgeHoldoutConcentration(evidence(
    split("validation", { maxVenueShare: 1.1 }),
  ));
  assert.equal(badShare.status, "PASS");
  assert.equal(badShare.hypotheses[0].status, "BLOCKED");
  assert.ok(badShare.hypotheses[0].validation.blockers.includes("MAX_VENUE_SHARE_INVALID"));

  const unsafeAuthorityFields = [
    "automaticPromotionAuthorized",
    "currentBuyConnectionAuthorized",
    "lineConnectionAuthorized",
    "publicPublishAuthorized",
    "automatedBettingAuthorized",
    "productionApplyAuthorized",
  ] as const;
  for (const field of unsafeAuthorityFields) {
    const base = evidence();
    const { outputDigest: _ignored, ...baseCore } = base;
    const badAuthority = rehashEvidence({
      ...baseCore,
      authority: { ...base.authority, [field]: true as never },
    });
    const authorityReport = evaluateN2EdgeHoldoutConcentration(badAuthority);
    assert.equal(authorityReport.status, "BLOCKED", field);
    assert.ok(
      authorityReport.blockers.includes("DISTRIBUTION_EVIDENCE_AUTHORITY_INVALID"),
      field,
    );
    assert.equal(authorityReport.hypothesisCount, 0, field);
  }
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
  const second = rehashEvidence(withoutDigest);
  const a = evaluateN2EdgeHoldoutConcentration(second);
  const { outputDigest: _secondDigest, ...secondWithoutDigest } = second;
  const bInput = rehashEvidence({ ...secondWithoutDigest, hypotheses: [...second.hypotheses].reverse() });
  const b = evaluateN2EdgeHoldoutConcentration(bInput);
  assert.equal(a.outputDigest, b.outputDigest);
  assert.deepEqual(a.hypotheses, b.hypotheses);
});
