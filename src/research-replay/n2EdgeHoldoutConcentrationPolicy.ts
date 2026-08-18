import { canonicalHash } from "./canonical";
import {
  N2_EDGE_HOLDOUT_DISTRIBUTION_EVIDENCE_VERSION,
  type N2EdgeHoldoutDistributionEvidenceReport,
  type N2EdgeHoldoutDistributionHypothesisEvidence,
  type N2EdgeHoldoutDistributionSplitEvidence,
} from "./n2EdgeHoldoutDistributionEvidence";
import { N2_EDGE_HOLDOUT_RACES_PER_VENUE_YEAR } from "./n2EdgeHoldoutCohort";
import { N2_EDGE_SCAN_MIN_UNIQUE_RACES } from "./n2EdgeHypothesisScan";

export const N2_EDGE_HOLDOUT_CONCENTRATION_POLICY_VERSION =
  "n2-edge-holdout-concentration-policy-v1" as const;

/**
 * Frozen before any production N2-041 distribution evidence is inspected.
 *
 * - 200 races reuses the historical-confirmation support floor.
 * - 12 venues requires breadth across at least half of the official 24 venues.
 * - 12% venue share is an integrity/concentration ceiling derived from the
 *   frozen holdout design: at most 12 races per venue-year × two years = 24;
 *   24 / 200 = 0.12 at the minimum confirmed support.
 * - both years must be represented and neither year may contribute >75%, so a
 *   nominal two-year holdout cannot be effectively a one-era result.
 */
export const N2_EDGE_HOLDOUT_MIN_DISTINCT_VENUES = 12;
export const N2_EDGE_HOLDOUT_MAX_VENUE_SHARE = 0.12;
export const N2_EDGE_HOLDOUT_MIN_DISTINCT_YEARS = 2;
export const N2_EDGE_HOLDOUT_MAX_YEAR_SHARE = 0.75;
export const N2_EDGE_HOLDOUT_MAX_RACES_PER_VENUE = 2 * N2_EDGE_HOLDOUT_RACES_PER_VENUE_YEAR;
export const N2_EDGE_HOLDOUT_MAX_RACES_PER_YEAR = 24 * N2_EDGE_HOLDOUT_RACES_PER_VENUE_YEAR;

export type N2EdgeHoldoutConcentrationSplitDecision = {
  split: "validation" | "test";
  status: "PASS" | "BLOCKED" | "INSUFFICIENT_EVIDENCE";
  blockers: string[];
  uniqueRaceCount: number;
  distinctVenueCount: number;
  maxVenueShare: number | null;
  distinctYearCount: number;
  maxYearShare: number | null;
};

export type N2EdgeHoldoutConcentrationHypothesisDecision = {
  hypothesisId: string;
  validation: N2EdgeHoldoutConcentrationSplitDecision;
  test: N2EdgeHoldoutConcentrationSplitDecision;
  status: "PASS" | "BLOCKED" | "INSUFFICIENT_EVIDENCE";
  blockers: string[];
};

export type N2EdgeHoldoutConcentrationPolicyReport = {
  policyVersion: typeof N2_EDGE_HOLDOUT_CONCENTRATION_POLICY_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  thresholds: {
    minUniqueRacesPerSplit: number;
    minDistinctVenuesPerSplit: number;
    maxVenueSharePerSplit: number;
    minDistinctYearsPerSplit: number;
    maxYearSharePerSplit: number;
  };
  hypothesisCount: number;
  passedHypothesisCount: number;
  blockedHypothesisCount: number;
  insufficientHypothesisCount: number;
  hypotheses: N2EdgeHoldoutConcentrationHypothesisDecision[];
  authority: {
    confirmationVerdictChanged: false;
    rejectedHypothesisRescueAuthorized: false;
    automaticPromotionAuthorized: false;
    forwardLabelsUsed: false;
    currentBuyConnectionAuthorized: false;
    lineConnectionAuthorized: false;
    publicPublishAuthorized: false;
    automatedBettingAuthorized: false;
    productionApplyAuthorized: false;
  };
  outputDigest: string;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function validShare(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value >= 0 && value <= 1);
}

function shareMatchesCount(share: number | null, maxCount: number, totalCount: number): boolean {
  if (totalCount === 0) return share === null && maxCount === 0;
  if (share === null) return false;
  return Math.abs(share - maxCount / totalCount) <= 1e-12;
}

function evaluateSplit(
  evidence: N2EdgeHoldoutDistributionSplitEvidence,
  expectedSplit: "validation" | "test",
): N2EdgeHoldoutConcentrationSplitDecision {
  const malformed: string[] = [];
  if (evidence.split !== expectedSplit) malformed.push(`SPLIT_LABEL_INVALID:${evidence.split}/${expectedSplit}`);
  if (!Number.isSafeInteger(evidence.uniqueRaceCount) || evidence.uniqueRaceCount < 0) malformed.push("UNIQUE_RACE_COUNT_INVALID");
  if (!Number.isSafeInteger(evidence.distinctVenueCount) || evidence.distinctVenueCount < 0 || evidence.distinctVenueCount > 24) malformed.push("DISTINCT_VENUE_COUNT_INVALID");
  if (!Number.isSafeInteger(evidence.maxVenueRaceCount) || evidence.maxVenueRaceCount < 0 || evidence.maxVenueRaceCount > evidence.uniqueRaceCount) malformed.push("MAX_VENUE_RACE_COUNT_INVALID");
  if (Number.isSafeInteger(evidence.maxVenueRaceCount) && evidence.maxVenueRaceCount > N2_EDGE_HOLDOUT_MAX_RACES_PER_VENUE) {
    malformed.push(`MAX_VENUE_RACE_COUNT_EXCEEDS_HOLDOUT:${evidence.maxVenueRaceCount}/${N2_EDGE_HOLDOUT_MAX_RACES_PER_VENUE}`);
  }
  if (!Number.isSafeInteger(evidence.distinctYearCount) || evidence.distinctYearCount < 0 || evidence.distinctYearCount > 2) malformed.push("DISTINCT_YEAR_COUNT_INVALID");
  if (!Number.isSafeInteger(evidence.maxYearRaceCount) || evidence.maxYearRaceCount < 0 || evidence.maxYearRaceCount > evidence.uniqueRaceCount) malformed.push("MAX_YEAR_RACE_COUNT_INVALID");
  if (Number.isSafeInteger(evidence.maxYearRaceCount) && evidence.maxYearRaceCount > N2_EDGE_HOLDOUT_MAX_RACES_PER_YEAR) {
    malformed.push(`MAX_YEAR_RACE_COUNT_EXCEEDS_HOLDOUT:${evidence.maxYearRaceCount}/${N2_EDGE_HOLDOUT_MAX_RACES_PER_YEAR}`);
  }
  if (!validShare(evidence.maxVenueShare)) malformed.push("MAX_VENUE_SHARE_INVALID");
  if (!validShare(evidence.maxYearShare)) malformed.push("MAX_YEAR_SHARE_INVALID");
  if (evidence.uniqueRaceCount === 0) {
    if (evidence.distinctVenueCount !== 0) malformed.push("ZERO_SUPPORT_VENUE_COUNT_MUST_BE_ZERO");
    if (evidence.distinctYearCount !== 0) malformed.push("ZERO_SUPPORT_YEAR_COUNT_MUST_BE_ZERO");
  } else {
    if (evidence.distinctVenueCount === 0) malformed.push("NONZERO_SUPPORT_VENUE_COUNT_MISSING");
    if (evidence.distinctYearCount === 0) malformed.push("NONZERO_SUPPORT_YEAR_COUNT_MISSING");
    if (Number.isSafeInteger(evidence.distinctVenueCount) && evidence.distinctVenueCount > evidence.uniqueRaceCount) {
      malformed.push("DISTINCT_VENUE_COUNT_EXCEEDS_SUPPORT");
    }
    if (Number.isSafeInteger(evidence.distinctYearCount) && evidence.distinctYearCount > evidence.uniqueRaceCount) {
      malformed.push("DISTINCT_YEAR_COUNT_EXCEEDS_SUPPORT");
    }
    if (Number.isSafeInteger(evidence.distinctVenueCount) && evidence.distinctVenueCount > 0
      && Number.isSafeInteger(evidence.maxVenueRaceCount)
      && evidence.maxVenueRaceCount > evidence.uniqueRaceCount - (evidence.distinctVenueCount - 1)) {
      malformed.push("MAX_VENUE_RACE_COUNT_LEAVES_NO_SUPPORT_FOR_DISTINCT_VENUES");
    }
    if (Number.isSafeInteger(evidence.distinctYearCount) && evidence.distinctYearCount > 0
      && Number.isSafeInteger(evidence.maxYearRaceCount)
      && evidence.maxYearRaceCount > evidence.uniqueRaceCount - (evidence.distinctYearCount - 1)) {
      malformed.push("MAX_YEAR_RACE_COUNT_LEAVES_NO_SUPPORT_FOR_DISTINCT_YEARS");
    }
    if (Number.isSafeInteger(evidence.distinctVenueCount) && evidence.distinctVenueCount > 0
      && Number.isSafeInteger(evidence.maxVenueRaceCount)
      && evidence.maxVenueRaceCount < Math.ceil(evidence.uniqueRaceCount / evidence.distinctVenueCount)) {
      malformed.push("MAX_VENUE_RACE_COUNT_TOO_SMALL_FOR_SUPPORT");
    }
    if (Number.isSafeInteger(evidence.distinctYearCount) && evidence.distinctYearCount > 0
      && Number.isSafeInteger(evidence.maxYearRaceCount)
      && evidence.maxYearRaceCount < Math.ceil(evidence.uniqueRaceCount / evidence.distinctYearCount)) {
      malformed.push("MAX_YEAR_RACE_COUNT_TOO_SMALL_FOR_SUPPORT");
    }
    if (Number.isSafeInteger(evidence.distinctYearCount) && evidence.distinctYearCount > 0
      && Number.isSafeInteger(evidence.maxVenueRaceCount)
      && evidence.maxVenueRaceCount > evidence.distinctYearCount * N2_EDGE_HOLDOUT_RACES_PER_VENUE_YEAR) {
      malformed.push("MAX_VENUE_RACE_COUNT_EXCEEDS_YEAR_CAPACITY");
    }
    if (Number.isSafeInteger(evidence.distinctVenueCount) && evidence.distinctVenueCount > 0
      && Number.isSafeInteger(evidence.maxYearRaceCount)
      && evidence.maxYearRaceCount > evidence.distinctVenueCount * N2_EDGE_HOLDOUT_RACES_PER_VENUE_YEAR) {
      malformed.push("MAX_YEAR_RACE_COUNT_EXCEEDS_VENUE_CAPACITY");
    }
  }
  if (!shareMatchesCount(evidence.maxVenueShare, evidence.maxVenueRaceCount, evidence.uniqueRaceCount)) {
    malformed.push("MAX_VENUE_SHARE_COUNT_MISMATCH");
  }
  if (!shareMatchesCount(evidence.maxYearShare, evidence.maxYearRaceCount, evidence.uniqueRaceCount)) {
    malformed.push("MAX_YEAR_SHARE_COUNT_MISMATCH");
  }
  if (malformed.length > 0) {
    return {
      split: evidence.split,
      status: "BLOCKED",
      blockers: malformed,
      uniqueRaceCount: evidence.uniqueRaceCount,
      distinctVenueCount: evidence.distinctVenueCount,
      maxVenueShare: evidence.maxVenueShare,
      distinctYearCount: evidence.distinctYearCount,
      maxYearShare: evidence.maxYearShare,
    };
  }
  if (evidence.uniqueRaceCount < N2_EDGE_SCAN_MIN_UNIQUE_RACES) {
    return {
      split: evidence.split,
      status: "INSUFFICIENT_EVIDENCE",
      blockers: [`UNIQUE_RACE_SUPPORT:${evidence.uniqueRaceCount}/${N2_EDGE_SCAN_MIN_UNIQUE_RACES}`],
      uniqueRaceCount: evidence.uniqueRaceCount,
      distinctVenueCount: evidence.distinctVenueCount,
      maxVenueShare: evidence.maxVenueShare,
      distinctYearCount: evidence.distinctYearCount,
      maxYearShare: evidence.maxYearShare,
    };
  }
  const blockers: string[] = [];
  if (evidence.distinctVenueCount < N2_EDGE_HOLDOUT_MIN_DISTINCT_VENUES) {
    blockers.push(`VENUE_BREADTH:${evidence.distinctVenueCount}/${N2_EDGE_HOLDOUT_MIN_DISTINCT_VENUES}`);
  }
  if ((evidence.maxVenueShare ?? 1) > N2_EDGE_HOLDOUT_MAX_VENUE_SHARE + 1e-12) {
    blockers.push(`VENUE_CONCENTRATION:${evidence.maxVenueShare}/${N2_EDGE_HOLDOUT_MAX_VENUE_SHARE}`);
  }
  if (evidence.distinctYearCount < N2_EDGE_HOLDOUT_MIN_DISTINCT_YEARS) {
    blockers.push(`YEAR_BREADTH:${evidence.distinctYearCount}/${N2_EDGE_HOLDOUT_MIN_DISTINCT_YEARS}`);
  }
  if ((evidence.maxYearShare ?? 1) > N2_EDGE_HOLDOUT_MAX_YEAR_SHARE + 1e-12) {
    blockers.push(`YEAR_CONCENTRATION:${evidence.maxYearShare}/${N2_EDGE_HOLDOUT_MAX_YEAR_SHARE}`);
  }
  return {
    split: evidence.split,
    status: blockers.length === 0 ? "PASS" : "BLOCKED",
    blockers,
    uniqueRaceCount: evidence.uniqueRaceCount,
    distinctVenueCount: evidence.distinctVenueCount,
    maxVenueShare: evidence.maxVenueShare,
    distinctYearCount: evidence.distinctYearCount,
    maxYearShare: evidence.maxYearShare,
  };
}

function evaluateHypothesis(
  evidence: N2EdgeHoldoutDistributionHypothesisEvidence,
): N2EdgeHoldoutConcentrationHypothesisDecision {
  const validation = evaluateSplit(evidence.validation, "validation");
  const test = evaluateSplit(evidence.test, "test");
  const blockers = unique([
    ...validation.blockers.map((blocker) => `validation:${blocker}`),
    ...test.blockers.map((blocker) => `test:${blocker}`),
  ]);
  const status = validation.status === "BLOCKED" || test.status === "BLOCKED"
    ? "BLOCKED" as const
    : validation.status === "INSUFFICIENT_EVIDENCE" || test.status === "INSUFFICIENT_EVIDENCE"
      ? "INSUFFICIENT_EVIDENCE" as const
      : "PASS" as const;
  return { hypothesisId: evidence.hypothesisId, validation, test, status, blockers };
}

export function evaluateN2EdgeHoldoutConcentration(
  evidence: N2EdgeHoldoutDistributionEvidenceReport,
): N2EdgeHoldoutConcentrationPolicyReport {
  const blockers: string[] = [];
  const { outputDigest, ...evidenceCore } = evidence;
  if (evidence.evidenceVersion !== N2_EDGE_HOLDOUT_DISTRIBUTION_EVIDENCE_VERSION) {
    blockers.push("DISTRIBUTION_EVIDENCE_VERSION_INVALID");
  }
  if (canonicalHash(evidenceCore) !== outputDigest) blockers.push("DISTRIBUTION_EVIDENCE_DIGEST_INVALID");
  if (evidence.status !== "PASS") blockers.push("DISTRIBUTION_EVIDENCE_NOT_PASS");
  if (evidence.lockedHypothesisCount !== evidence.hypotheses.length) blockers.push("DISTRIBUTION_EVIDENCE_COUNT_MISMATCH");
  const inputCountsValid = Number.isSafeInteger(evidence.inputRaceCount) && evidence.inputRaceCount >= 0
    && Number.isSafeInteger(evidence.validationInputRaceCount) && evidence.validationInputRaceCount >= 0
    && Number.isSafeInteger(evidence.testInputRaceCount) && evidence.testInputRaceCount >= 0;
  if (!inputCountsValid) {
    blockers.push("DISTRIBUTION_EVIDENCE_INPUT_COUNT_INVALID");
  } else if (evidence.inputRaceCount !== evidence.validationInputRaceCount + evidence.testInputRaceCount) {
    blockers.push("DISTRIBUTION_EVIDENCE_INPUT_COUNT_MISMATCH");
  }
  if (new Set(evidence.hypotheses.map((item) => item.hypothesisId)).size !== evidence.hypotheses.length) {
    blockers.push("DISTRIBUTION_EVIDENCE_DUPLICATE_HYPOTHESIS");
  }
  if (inputCountsValid) {
    for (const item of evidence.hypotheses) {
      if (Number.isSafeInteger(item.validation.uniqueRaceCount)
        && item.validation.uniqueRaceCount > evidence.validationInputRaceCount) {
        blockers.push(
          `DISTRIBUTION_EVIDENCE_VALIDATION_SUPPORT_EXCEEDS_INPUT:${item.hypothesisId}`
          + `:${item.validation.uniqueRaceCount}/${evidence.validationInputRaceCount}`,
        );
      }
      if (Number.isSafeInteger(item.test.uniqueRaceCount)
        && item.test.uniqueRaceCount > evidence.testInputRaceCount) {
        blockers.push(
          `DISTRIBUTION_EVIDENCE_TEST_SUPPORT_EXCEEDS_INPUT:${item.hypothesisId}`
          + `:${item.test.uniqueRaceCount}/${evidence.testInputRaceCount}`,
        );
      }
    }
  }
  if (evidence.privacy.raceKeysPersisted !== false
    || evidence.privacy.venueCodesPersisted !== false
    || evidence.privacy.yearsPersisted !== false
    || evidence.privacy.perRaceResidualsPersisted !== false) {
    blockers.push("DISTRIBUTION_EVIDENCE_PRIVACY_INVALID");
  }
  if (evidence.authority.confirmationVerdictChanged !== false
    || evidence.authority.rejectionRescueAuthorized !== false
    || evidence.authority.automaticPromotionAuthorized !== false
    || evidence.authority.forwardLabelsUsed !== false
    || evidence.authority.currentBuyConnectionAuthorized !== false
    || evidence.authority.lineConnectionAuthorized !== false
    || evidence.authority.publicPublishAuthorized !== false
    || evidence.authority.automatedBettingAuthorized !== false
    || evidence.authority.productionApplyAuthorized !== false) {
    blockers.push("DISTRIBUTION_EVIDENCE_AUTHORITY_INVALID");
  }
  const hypotheses = blockers.length === 0
    ? [...evidence.hypotheses]
      .sort((left, right) => left.hypothesisId.localeCompare(right.hypothesisId))
      .map(evaluateHypothesis)
    : [];
  const core = {
    policyVersion: N2_EDGE_HOLDOUT_CONCENTRATION_POLICY_VERSION,
    status: blockers.length === 0 ? "PASS" as const : "BLOCKED" as const,
    blockers: unique(blockers),
    thresholds: {
      minUniqueRacesPerSplit: N2_EDGE_SCAN_MIN_UNIQUE_RACES,
      minDistinctVenuesPerSplit: N2_EDGE_HOLDOUT_MIN_DISTINCT_VENUES,
      maxVenueSharePerSplit: N2_EDGE_HOLDOUT_MAX_VENUE_SHARE,
      minDistinctYearsPerSplit: N2_EDGE_HOLDOUT_MIN_DISTINCT_YEARS,
      maxYearSharePerSplit: N2_EDGE_HOLDOUT_MAX_YEAR_SHARE,
    },
    hypothesisCount: hypotheses.length,
    passedHypothesisCount: hypotheses.filter((item) => item.status === "PASS").length,
    blockedHypothesisCount: hypotheses.filter((item) => item.status === "BLOCKED").length,
    insufficientHypothesisCount: hypotheses.filter((item) => item.status === "INSUFFICIENT_EVIDENCE").length,
    hypotheses,
    authority: {
      confirmationVerdictChanged: false as const,
      rejectedHypothesisRescueAuthorized: false as const,
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