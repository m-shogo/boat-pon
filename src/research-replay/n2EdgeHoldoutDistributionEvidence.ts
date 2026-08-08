import { canonicalHash } from "./canonical";
import { splitForN2RaceKey } from "./n2BaselineEvaluation";
import type { N2EdgeConfirmationRace } from "./n2EdgeHistoricalConfirmation";

export const N2_EDGE_HOLDOUT_DISTRIBUTION_EVIDENCE_VERSION =
  "n2-edge-holdout-distribution-evidence-v1" as const;

const RACE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;

export type N2EdgeHoldoutDistributionSplitEvidence = {
  split: "validation" | "test";
  uniqueRaceCount: number;
  distinctVenueCount: number;
  maxVenueRaceCount: number;
  maxVenueShare: number | null;
  distinctYearCount: number;
  maxYearRaceCount: number;
  maxYearShare: number | null;
};

export type N2EdgeHoldoutDistributionHypothesisEvidence = {
  hypothesisId: string;
  validation: N2EdgeHoldoutDistributionSplitEvidence;
  test: N2EdgeHoldoutDistributionSplitEvidence;
};

export type N2EdgeHoldoutDistributionEvidenceReport = {
  evidenceVersion: typeof N2_EDGE_HOLDOUT_DISTRIBUTION_EVIDENCE_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  lockedHypothesisCount: number;
  inputRaceCount: number;
  validationInputRaceCount: number;
  testInputRaceCount: number;
  hypotheses: N2EdgeHoldoutDistributionHypothesisEvidence[];
  privacy: {
    raceKeysPersisted: false;
    venueCodesPersisted: false;
    yearsPersisted: false;
    perRaceResidualsPersisted: false;
  };
  authority: {
    confirmationVerdictChanged: false;
    rejectionRescueAuthorized: false;
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

type ParsedRace = {
  year: string;
  venueCode: string;
};

type Counter = {
  raceCount: number;
  venues: Map<string, number>;
  years: Map<string, number>;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function parseRaceKey(value: string): ParsedRace | null {
  const match = RACE_KEY_RE.exec(value);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))) return null;
  return { year: match[1], venueCode: match[4] };
}

function emptyCounter(): Counter {
  return { raceCount: 0, venues: new Map(), years: new Map() };
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function splitEvidence(split: "validation" | "test", counter: Counter): N2EdgeHoldoutDistributionSplitEvidence {
  const maxVenueRaceCount = Math.max(0, ...counter.venues.values());
  const maxYearRaceCount = Math.max(0, ...counter.years.values());
  return {
    split,
    uniqueRaceCount: counter.raceCount,
    distinctVenueCount: counter.venues.size,
    maxVenueRaceCount,
    maxVenueShare: counter.raceCount === 0 ? null : maxVenueRaceCount / counter.raceCount,
    distinctYearCount: counter.years.size,
    maxYearRaceCount,
    maxYearShare: counter.raceCount === 0 ? null : maxYearRaceCount / counter.raceCount,
  };
}

function blocked(input: {
  blockers: string[];
  lockedHypothesisCount: number;
  inputRaceCount: number;
  validationInputRaceCount: number;
  testInputRaceCount: number;
}): N2EdgeHoldoutDistributionEvidenceReport {
  const core = {
    evidenceVersion: N2_EDGE_HOLDOUT_DISTRIBUTION_EVIDENCE_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(input.blockers),
    lockedHypothesisCount: input.lockedHypothesisCount,
    inputRaceCount: input.inputRaceCount,
    validationInputRaceCount: input.validationInputRaceCount,
    testInputRaceCount: input.testInputRaceCount,
    hypotheses: [] as N2EdgeHoldoutDistributionHypothesisEvidence[],
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

/**
 * Aggregate-only evidence for later confounder review. This function does not
 * decide whether concentration is acceptable and cannot change confirmation or
 * rejection outcomes. It records only counts and maximum shares, never which
 * venue/year was dominant.
 */
export function buildN2EdgeHoldoutDistributionEvidence(input: {
  lockedHypothesisIds: string[];
  races: N2EdgeConfirmationRace[];
}): N2EdgeHoldoutDistributionEvidenceReport {
  const blockers: string[] = [];
  const lockedIds = [...input.lockedHypothesisIds].sort();
  if (new Set(lockedIds).size !== lockedIds.length) blockers.push("DUPLICATE_LOCKED_HYPOTHESIS_ID");
  const locked = new Set(lockedIds);
  const seenRaceKeys = new Set<string>();
  const parsedByRace = new Map<string, ParsedRace>();
  let validationInputRaceCount = 0;
  let testInputRaceCount = 0;

  for (const race of input.races) {
    const parsed = parseRaceKey(race.canonicalRaceKey);
    if (!parsed) blockers.push(`INVALID_RACE_KEY:${race.canonicalRaceKey}`);
    else parsedByRace.set(race.canonicalRaceKey, parsed);
    if (seenRaceKeys.has(race.canonicalRaceKey)) blockers.push(`DUPLICATE_RACE:${race.canonicalRaceKey}`);
    seenRaceKeys.add(race.canonicalRaceKey);
    const canonicalSplit = splitForN2RaceKey(race.canonicalRaceKey);
    if (canonicalSplit !== race.split) blockers.push(`SPLIT_MISMATCH:${race.canonicalRaceKey}:${race.split}/${canonicalSplit ?? "INVALID"}`);
    if (race.split === "validation") validationInputRaceCount += 1;
    else if (race.split === "test") testInputRaceCount += 1;
    else blockers.push(`NON_HOLDOUT_SPLIT:${race.split}`);
    for (const [hypothesisId, residual] of Object.entries(race.residualByHypothesisId)) {
      if (!locked.has(hypothesisId)) blockers.push(`UNKNOWN_HYPOTHESIS_ID:${hypothesisId}`);
      if (!Number.isFinite(residual) || residual < -1 || residual > 1) blockers.push(`${hypothesisId}:INVALID_RACE_RESIDUAL`);
    }
  }

  if (blockers.length > 0) {
    return blocked({
      blockers,
      lockedHypothesisCount: lockedIds.length,
      inputRaceCount: input.races.length,
      validationInputRaceCount,
      testInputRaceCount,
    });
  }

  const counters = new Map<string, { validation: Counter; test: Counter }>();
  for (const hypothesisId of lockedIds) {
    counters.set(hypothesisId, { validation: emptyCounter(), test: emptyCounter() });
  }
  for (const race of input.races) {
    const parsed = parsedByRace.get(race.canonicalRaceKey)!;
    for (const hypothesisId of Object.keys(race.residualByHypothesisId)) {
      const counter = counters.get(hypothesisId)![race.split];
      counter.raceCount += 1;
      increment(counter.venues, parsed.venueCode);
      increment(counter.years, parsed.year);
    }
  }

  const hypotheses = lockedIds.map((hypothesisId) => {
    const value = counters.get(hypothesisId)!;
    return {
      hypothesisId,
      validation: splitEvidence("validation", value.validation),
      test: splitEvidence("test", value.test),
    };
  });
  const core = {
    evidenceVersion: N2_EDGE_HOLDOUT_DISTRIBUTION_EVIDENCE_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    lockedHypothesisCount: lockedIds.length,
    inputRaceCount: input.races.length,
    validationInputRaceCount,
    testInputRaceCount,
    hypotheses,
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
