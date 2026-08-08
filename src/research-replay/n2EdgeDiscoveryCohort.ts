import { canonicalHash } from "./canonical";
import { splitForN2RaceKey } from "./n2BaselineEvaluation";

export const N2_EDGE_DISCOVERY_COHORT_VERSION =
  "n2-edge-discovery-cohort-v1" as const;
export const N2_EDGE_DISCOVERY_FROM_DATE = "2004-01-01" as const;
export const N2_EDGE_DISCOVERY_TO_DATE = "2021-12-31" as const;
export const N2_EDGE_DISCOVERY_RACES_PER_VENUE_YEAR = 12;
export const N2_EDGE_DISCOVERY_MAX_VENUES = 24;
export const N2_EDGE_DISCOVERY_YEAR_COUNT = 18;
export const N2_EDGE_DISCOVERY_MAX_RACES =
  N2_EDGE_DISCOVERY_RACES_PER_VENUE_YEAR
  * N2_EDGE_DISCOVERY_MAX_VENUES
  * N2_EDGE_DISCOVERY_YEAR_COUNT;
export const N2_EDGE_DISCOVERY_MAX_SELECTION_ROWS = N2_EDGE_DISCOVERY_MAX_RACES * 120;
export const N2_EDGE_DISCOVERY_HASH_SALT = "boat-pon:n2-edge-discovery:v1" as const;

const RACE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;

export type N2EdgeDiscoveryRaceCandidate = {
  canonicalRaceKey: string;
};

export type N2EdgeDiscoveryCohortRace = {
  canonicalRaceKey: string;
  year: number;
  venueCode: string;
  stratumId: string;
  deterministicRankDigest: string;
};

export type N2EdgeDiscoveryCohortReport = {
  cohortVersion: typeof N2_EDGE_DISCOVERY_COHORT_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  policy: {
    fromDateInclusive: typeof N2_EDGE_DISCOVERY_FROM_DATE;
    toDateInclusive: typeof N2_EDGE_DISCOVERY_TO_DATE;
    canonicalSplitRequired: "train";
    samplingUnit: "race";
    stratum: "year_x_venue";
    maxRacesPerStratum: number;
    deterministicRanking: "sha256(salt|canonicalRaceKey)_ascending";
    outcomeDependentSamplingAllowed: false;
    labelDependentSamplingAllowed: false;
    featureDependentSamplingAllowed: false;
    payoutDependentSamplingAllowed: false;
    maxRaceCount: number;
    maxSelectionRowCount: number;
  };
  inputRaceCount: number;
  eligibleRaceCount: number;
  excludedBefore2004Count: number;
  excludedAfterTrainCount: number;
  invalidRaceKeyCount: number;
  duplicateRaceKeyCount: number;
  selectedRaceCount: number;
  selectedSelectionRowCount: number;
  representedYearCount: number;
  representedVenueCount: number;
  representedStratumCount: number;
  selectedByStratum: Record<string, number>;
  races: N2EdgeDiscoveryCohortRace[];
  cohortDigest: string;
  outputDigest: string;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function parseRaceKey(value: string): { date: string; year: number; venueCode: string } | null {
  const match = RACE_KEY_RE.exec(value);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))) return null;
  return { date, year: Number(match[1]), venueCode: match[4] };
}

function rankDigest(canonicalRaceKey: string): string {
  return canonicalHash(`${N2_EDGE_DISCOVERY_HASH_SALT}|${canonicalRaceKey}`);
}

function buildBlocked(input: {
  blockers: string[];
  inputRaceCount: number;
  invalidRaceKeyCount: number;
  duplicateRaceKeyCount: number;
}): N2EdgeDiscoveryCohortReport {
  const core = {
    cohortVersion: N2_EDGE_DISCOVERY_COHORT_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(input.blockers),
    policy: {
      fromDateInclusive: N2_EDGE_DISCOVERY_FROM_DATE,
      toDateInclusive: N2_EDGE_DISCOVERY_TO_DATE,
      canonicalSplitRequired: "train" as const,
      samplingUnit: "race" as const,
      stratum: "year_x_venue" as const,
      maxRacesPerStratum: N2_EDGE_DISCOVERY_RACES_PER_VENUE_YEAR,
      deterministicRanking: "sha256(salt|canonicalRaceKey)_ascending" as const,
      outcomeDependentSamplingAllowed: false as const,
      labelDependentSamplingAllowed: false as const,
      featureDependentSamplingAllowed: false as const,
      payoutDependentSamplingAllowed: false as const,
      maxRaceCount: N2_EDGE_DISCOVERY_MAX_RACES,
      maxSelectionRowCount: N2_EDGE_DISCOVERY_MAX_SELECTION_ROWS,
    },
    inputRaceCount: input.inputRaceCount,
    eligibleRaceCount: 0,
    excludedBefore2004Count: 0,
    excludedAfterTrainCount: 0,
    invalidRaceKeyCount: input.invalidRaceKeyCount,
    duplicateRaceKeyCount: input.duplicateRaceKeyCount,
    selectedRaceCount: 0,
    selectedSelectionRowCount: 0,
    representedYearCount: 0,
    representedVenueCount: 0,
    representedStratumCount: 0,
    selectedByStratum: {} as Record<string, number>,
    races: [] as N2EdgeDiscoveryCohortRace[],
    cohortDigest: canonicalHash([]),
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function buildN2EdgeDiscoveryCohort(
  candidates: N2EdgeDiscoveryRaceCandidate[],
): N2EdgeDiscoveryCohortReport {
  const duplicateRaceKeyCount = candidates.length - new Set(candidates.map((item) => item.canonicalRaceKey)).size;
  const parsed: Array<{ canonicalRaceKey: string; date: string; year: number; venueCode: string }> = [];
  let invalidRaceKeyCount = 0;
  let excludedBefore2004Count = 0;
  let excludedAfterTrainCount = 0;
  for (const candidate of candidates) {
    const race = parseRaceKey(candidate.canonicalRaceKey);
    if (!race) {
      invalidRaceKeyCount += 1;
      continue;
    }
    const split = splitForN2RaceKey(candidate.canonicalRaceKey);
    if (race.date < N2_EDGE_DISCOVERY_FROM_DATE) {
      excludedBefore2004Count += 1;
      continue;
    }
    if (race.date > N2_EDGE_DISCOVERY_TO_DATE || split !== "train") {
      excludedAfterTrainCount += 1;
      continue;
    }
    parsed.push({ canonicalRaceKey: candidate.canonicalRaceKey, ...race });
  }
  const blockers: string[] = [];
  if (duplicateRaceKeyCount > 0) blockers.push(`DUPLICATE_RACE_KEYS:${duplicateRaceKeyCount}`);
  if (invalidRaceKeyCount > 0) blockers.push(`INVALID_RACE_KEYS:${invalidRaceKeyCount}`);
  if (blockers.length > 0) {
    return buildBlocked({
      blockers,
      inputRaceCount: candidates.length,
      invalidRaceKeyCount,
      duplicateRaceKeyCount,
    });
  }

  const strata = new Map<string, typeof parsed>();
  for (const race of parsed) {
    const stratumId = `${race.year}:${race.venueCode}`;
    const current = strata.get(stratumId) ?? [];
    current.push(race);
    strata.set(stratumId, current);
  }

  const selected: N2EdgeDiscoveryCohortRace[] = [];
  const selectedByStratum: Record<string, number> = {};
  for (const [stratumId, races] of [...strata.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const chosen = [...races]
      .map((race) => ({ ...race, deterministicRankDigest: rankDigest(race.canonicalRaceKey) }))
      .sort((left, right) =>
        left.deterministicRankDigest.localeCompare(right.deterministicRankDigest)
        || left.canonicalRaceKey.localeCompare(right.canonicalRaceKey),
      )
      .slice(0, N2_EDGE_DISCOVERY_RACES_PER_VENUE_YEAR);
    selectedByStratum[stratumId] = chosen.length;
    selected.push(...chosen.map((race) => ({
      canonicalRaceKey: race.canonicalRaceKey,
      year: race.year,
      venueCode: race.venueCode,
      stratumId,
      deterministicRankDigest: race.deterministicRankDigest,
    })));
  }

  selected.sort((left, right) => left.canonicalRaceKey.localeCompare(right.canonicalRaceKey));
  const representedYears = new Set(selected.map((race) => race.year));
  const representedVenues = new Set(selected.map((race) => race.venueCode));
  const cohortDigest = canonicalHash(selected.map((race) => race.canonicalRaceKey));
  const core = {
    cohortVersion: N2_EDGE_DISCOVERY_COHORT_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    policy: {
      fromDateInclusive: N2_EDGE_DISCOVERY_FROM_DATE,
      toDateInclusive: N2_EDGE_DISCOVERY_TO_DATE,
      canonicalSplitRequired: "train" as const,
      samplingUnit: "race" as const,
      stratum: "year_x_venue" as const,
      maxRacesPerStratum: N2_EDGE_DISCOVERY_RACES_PER_VENUE_YEAR,
      deterministicRanking: "sha256(salt|canonicalRaceKey)_ascending" as const,
      outcomeDependentSamplingAllowed: false as const,
      labelDependentSamplingAllowed: false as const,
      featureDependentSamplingAllowed: false as const,
      payoutDependentSamplingAllowed: false as const,
      maxRaceCount: N2_EDGE_DISCOVERY_MAX_RACES,
      maxSelectionRowCount: N2_EDGE_DISCOVERY_MAX_SELECTION_ROWS,
    },
    inputRaceCount: candidates.length,
    eligibleRaceCount: parsed.length,
    excludedBefore2004Count,
    excludedAfterTrainCount,
    invalidRaceKeyCount,
    duplicateRaceKeyCount,
    selectedRaceCount: selected.length,
    selectedSelectionRowCount: selected.length * 120,
    representedYearCount: representedYears.size,
    representedVenueCount: representedVenues.size,
    representedStratumCount: Object.values(selectedByStratum).filter((count) => count > 0).length,
    selectedByStratum,
    races: selected,
    cohortDigest,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
