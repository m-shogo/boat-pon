import { canonicalHash } from "./canonical";
import { splitForN2RaceKey } from "./n2BaselineEvaluation";

export const N2_EDGE_HOLDOUT_COHORT_VERSION = "n2-edge-holdout-cohort-v1" as const;
export const N2_EDGE_HOLDOUT_RACES_PER_VENUE_YEAR = 12;
export const N2_EDGE_VALIDATION_FROM_DATE = "2022-01-01" as const;
export const N2_EDGE_VALIDATION_TO_DATE = "2023-12-31" as const;
export const N2_EDGE_TEST_FROM_DATE = "2024-01-01" as const;
export const N2_EDGE_TEST_TO_DATE = "2025-12-31" as const;
export const N2_EDGE_HOLDOUT_MAX_RACES_PER_SPLIT = 2 * 24 * N2_EDGE_HOLDOUT_RACES_PER_VENUE_YEAR;
export const N2_EDGE_HOLDOUT_HASH_SALT = "boat-pon:n2-edge-holdout:v1" as const;

const RACE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;

export type N2EdgeHoldoutCandidate = { canonicalRaceKey: string };
export type N2EdgeHoldoutSplit = "validation" | "test";
export type N2EdgeHoldoutRace = {
  canonicalRaceKey: string;
  split: N2EdgeHoldoutSplit;
  year: number;
  venueCode: string;
  stratumId: string;
  deterministicRankDigest: string;
};

export type N2EdgeHoldoutCohortReport = {
  cohortVersion: typeof N2_EDGE_HOLDOUT_COHORT_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  policy: {
    validationRange: [typeof N2_EDGE_VALIDATION_FROM_DATE, typeof N2_EDGE_VALIDATION_TO_DATE];
    testRange: [typeof N2_EDGE_TEST_FROM_DATE, typeof N2_EDGE_TEST_TO_DATE];
    samplingUnit: "race";
    stratum: "split_x_year_x_venue";
    maxRacesPerStratum: number;
    deterministicRanking: "sha256(salt|split|canonicalRaceKey)_ascending";
    outcomeValueUsedForSampling: false;
    hypothesisResultUsedForSampling: false;
    featureValueUsedForSampling: false;
    payoutUsedForSampling: false;
    maxRacesPerSplit: number;
  };
  inputRaceCount: number;
  eligibleValidationRaceCount: number;
  eligibleTestRaceCount: number;
  excludedOutsideHoldoutCount: number;
  invalidRaceKeyCount: number;
  duplicateRaceKeyCount: number;
  selectedValidationRaceCount: number;
  selectedTestRaceCount: number;
  selectedByStratum: Record<string, number>;
  races: N2EdgeHoldoutRace[];
  validationCohortDigest: string;
  testCohortDigest: string;
  outputDigest: string;
};

function parse(value: string): { date: string; year: number; venueCode: string } | null {
  const match = RACE_KEY_RE.exec(value);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))) return null;
  return { date, year: Number(match[1]), venueCode: match[4] };
}

function unique(values: string[]): string[] { return [...new Set(values)].sort(); }

function blocked(blockers: string[], inputRaceCount: number, invalidRaceKeyCount: number, duplicateRaceKeyCount: number): N2EdgeHoldoutCohortReport {
  const core = {
    cohortVersion: N2_EDGE_HOLDOUT_COHORT_VERSION,
    status: "BLOCKED" as const,
    blockers: unique(blockers),
    policy: {
      validationRange: [N2_EDGE_VALIDATION_FROM_DATE, N2_EDGE_VALIDATION_TO_DATE] as [typeof N2_EDGE_VALIDATION_FROM_DATE, typeof N2_EDGE_VALIDATION_TO_DATE],
      testRange: [N2_EDGE_TEST_FROM_DATE, N2_EDGE_TEST_TO_DATE] as [typeof N2_EDGE_TEST_FROM_DATE, typeof N2_EDGE_TEST_TO_DATE],
      samplingUnit: "race" as const,
      stratum: "split_x_year_x_venue" as const,
      maxRacesPerStratum: N2_EDGE_HOLDOUT_RACES_PER_VENUE_YEAR,
      deterministicRanking: "sha256(salt|split|canonicalRaceKey)_ascending" as const,
      outcomeValueUsedForSampling: false as const,
      hypothesisResultUsedForSampling: false as const,
      featureValueUsedForSampling: false as const,
      payoutUsedForSampling: false as const,
      maxRacesPerSplit: N2_EDGE_HOLDOUT_MAX_RACES_PER_SPLIT,
    },
    inputRaceCount,
    eligibleValidationRaceCount: 0,
    eligibleTestRaceCount: 0,
    excludedOutsideHoldoutCount: 0,
    invalidRaceKeyCount,
    duplicateRaceKeyCount,
    selectedValidationRaceCount: 0,
    selectedTestRaceCount: 0,
    selectedByStratum: {} as Record<string, number>,
    races: [] as N2EdgeHoldoutRace[],
    validationCohortDigest: canonicalHash([]),
    testCohortDigest: canonicalHash([]),
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function buildN2EdgeHoldoutCohort(candidates: N2EdgeHoldoutCandidate[]): N2EdgeHoldoutCohortReport {
  const duplicateRaceKeyCount = candidates.length - new Set(candidates.map((item) => item.canonicalRaceKey)).size;
  let invalidRaceKeyCount = 0;
  let excludedOutsideHoldoutCount = 0;
  const eligible: Array<{ canonicalRaceKey: string; split: N2EdgeHoldoutSplit; year: number; venueCode: string }> = [];
  for (const candidate of candidates) {
    const parsed = parse(candidate.canonicalRaceKey);
    if (!parsed) { invalidRaceKeyCount += 1; continue; }
    const split = splitForN2RaceKey(candidate.canonicalRaceKey);
    const expected: N2EdgeHoldoutSplit | null = parsed.date >= N2_EDGE_VALIDATION_FROM_DATE && parsed.date <= N2_EDGE_VALIDATION_TO_DATE
      ? "validation"
      : parsed.date >= N2_EDGE_TEST_FROM_DATE && parsed.date <= N2_EDGE_TEST_TO_DATE ? "test" : null;
    if (expected === null || split !== expected) { excludedOutsideHoldoutCount += 1; continue; }
    eligible.push({ canonicalRaceKey: candidate.canonicalRaceKey, split: expected, year: parsed.year, venueCode: parsed.venueCode });
  }
  const blockers: string[] = [];
  if (duplicateRaceKeyCount > 0) blockers.push(`DUPLICATE_RACE_KEYS:${duplicateRaceKeyCount}`);
  if (invalidRaceKeyCount > 0) blockers.push(`INVALID_RACE_KEYS:${invalidRaceKeyCount}`);
  if (blockers.length > 0) return blocked(blockers, candidates.length, invalidRaceKeyCount, duplicateRaceKeyCount);

  const strata = new Map<string, typeof eligible>();
  for (const race of eligible) {
    const stratumId = `${race.split}:${race.year}:${race.venueCode}`;
    const current = strata.get(stratumId) ?? [];
    current.push(race);
    strata.set(stratumId, current);
  }
  const selected: N2EdgeHoldoutRace[] = [];
  const selectedByStratum: Record<string, number> = {};
  for (const [stratumId, races] of [...strata.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const chosen = races.map((race) => ({
      ...race,
      deterministicRankDigest: canonicalHash(`${N2_EDGE_HOLDOUT_HASH_SALT}|${race.split}|${race.canonicalRaceKey}`),
    })).sort((a, b) => a.deterministicRankDigest.localeCompare(b.deterministicRankDigest) || a.canonicalRaceKey.localeCompare(b.canonicalRaceKey))
      .slice(0, N2_EDGE_HOLDOUT_RACES_PER_VENUE_YEAR);
    selectedByStratum[stratumId] = chosen.length;
    selected.push(...chosen.map((race) => ({ ...race, stratumId })));
  }
  selected.sort((a, b) => a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));
  const validation = selected.filter((race) => race.split === "validation");
  const test = selected.filter((race) => race.split === "test");
  const core = {
    cohortVersion: N2_EDGE_HOLDOUT_COHORT_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    policy: {
      validationRange: [N2_EDGE_VALIDATION_FROM_DATE, N2_EDGE_VALIDATION_TO_DATE] as [typeof N2_EDGE_VALIDATION_FROM_DATE, typeof N2_EDGE_VALIDATION_TO_DATE],
      testRange: [N2_EDGE_TEST_FROM_DATE, N2_EDGE_TEST_TO_DATE] as [typeof N2_EDGE_TEST_FROM_DATE, typeof N2_EDGE_TEST_TO_DATE],
      samplingUnit: "race" as const,
      stratum: "split_x_year_x_venue" as const,
      maxRacesPerStratum: N2_EDGE_HOLDOUT_RACES_PER_VENUE_YEAR,
      deterministicRanking: "sha256(salt|split|canonicalRaceKey)_ascending" as const,
      outcomeValueUsedForSampling: false as const,
      hypothesisResultUsedForSampling: false as const,
      featureValueUsedForSampling: false as const,
      payoutUsedForSampling: false as const,
      maxRacesPerSplit: N2_EDGE_HOLDOUT_MAX_RACES_PER_SPLIT,
    },
    inputRaceCount: candidates.length,
    eligibleValidationRaceCount: eligible.filter((race) => race.split === "validation").length,
    eligibleTestRaceCount: eligible.filter((race) => race.split === "test").length,
    excludedOutsideHoldoutCount,
    invalidRaceKeyCount,
    duplicateRaceKeyCount,
    selectedValidationRaceCount: validation.length,
    selectedTestRaceCount: test.length,
    selectedByStratum,
    races: selected,
    validationCohortDigest: canonicalHash(validation.map((race) => race.canonicalRaceKey)),
    testCohortDigest: canonicalHash(test.map((race) => race.canonicalRaceKey)),
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
