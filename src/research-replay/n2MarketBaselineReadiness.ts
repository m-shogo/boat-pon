import { canonicalHash } from "./canonical";

export const N2_MARKET_BASELINE_READINESS_VERSION =
  "n2-market-baseline-readiness-v1" as const;
export const N2_MARKET_BASELINE_MIN_SETTLED_RACES = 20;
export const N2_MARKET_BASELINE_READINESS_STATUSES = [
  "BLOCKED",
  "NO_PRIVATE_MARKET_DATA",
  "WAITING_FOR_SETTLEMENT",
  "ACCUMULATING",
  "READY_FOR_N2_020",
] as const;

export type N2MarketBaselineReadinessStatus =
  (typeof N2_MARKET_BASELINE_READINESS_STATUSES)[number];

export type N2MarketBaselineReadinessReport = {
  reportVersion: typeof N2_MARKET_BASELINE_READINESS_VERSION;
  status: N2MarketBaselineReadinessStatus;
  minimumSettledRaceCount: number;
  acceptedT5RaceCount: number;
  settledAcceptedT5RaceCount: number;
  unsettledAcceptedT5RaceCount: number;
  distinctAcceptedDateCount: number;
  distinctSettledDateCount: number;
  earliestAcceptedDate: string | null;
  latestAcceptedDate: string | null;
  integrityBlockedRaceCount: number;
  blockers: string[];
  n2TaskId: "TASK-N2-020";
  n2TaskReady: boolean;
  automaticPromotionAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  publicPublishAuthorized: false;
  databaseWriteAuthorized: false;
  automatedBettingAuthorized: false;
  productionApplyAuthorized: false;
  outputDigest: string;
};

const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;

function uniqueRaceKeys(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function raceDate(raceKey: string): string | null {
  return RACE_KEY_RE.exec(raceKey)?.[1] ?? null;
}

function uniqueDates(raceKeys: readonly string[]): string[] {
  return [...new Set(raceKeys.map(raceDate).filter((value): value is string => value != null))].sort();
}

export function buildN2MarketBaselineReadinessReport(input: {
  acceptedT5RaceKeys: readonly string[];
  settledRaceKeys: readonly string[];
  integrityBlockedRaceKeys?: readonly string[];
  sourceBlockers?: readonly string[];
  minimumSettledRaceCount?: number;
}): N2MarketBaselineReadinessReport {
  const minimumSettledRaceCount = input.minimumSettledRaceCount
    ?? N2_MARKET_BASELINE_MIN_SETTLED_RACES;
  if (!Number.isSafeInteger(minimumSettledRaceCount) || minimumSettledRaceCount < 1) {
    throw new Error("N2_MARKET_BASELINE_MIN_SETTLED_RACES_INVALID");
  }

  const accepted = uniqueRaceKeys(input.acceptedT5RaceKeys);
  const acceptedSet = new Set(accepted);
  const settled = uniqueRaceKeys(input.settledRaceKeys).filter((raceKey) => acceptedSet.has(raceKey));
  const integrityBlocked = uniqueRaceKeys(input.integrityBlockedRaceKeys ?? []);
  const invalidRaceKeyCount = uniqueRaceKeys([
    ...accepted,
    ...settled,
    ...integrityBlocked,
  ]).filter((raceKey) => !RACE_KEY_RE.test(raceKey)).length;

  const blockers = [...new Set([
    ...(input.sourceBlockers ?? []),
    ...(invalidRaceKeyCount > 0 ? [`INVALID_CANONICAL_RACE_KEY:${invalidRaceKeyCount}`] : []),
    ...(integrityBlocked.length > 0 ? [`PRIVATE_CAPTURE_INTEGRITY_BLOCKED:${integrityBlocked.length}`] : []),
  ])].sort();
  const acceptedDates = uniqueDates(accepted);
  const settledDates = uniqueDates(settled);
  const unsettledAcceptedT5RaceCount = accepted.length - settled.length;

  const status: N2MarketBaselineReadinessStatus = blockers.length > 0
    ? "BLOCKED"
    : accepted.length === 0
      ? "NO_PRIVATE_MARKET_DATA"
      : settled.length === 0
        ? "WAITING_FOR_SETTLEMENT"
        : settled.length < minimumSettledRaceCount
          ? "ACCUMULATING"
          : "READY_FOR_N2_020";

  const core = {
    reportVersion: N2_MARKET_BASELINE_READINESS_VERSION,
    status,
    minimumSettledRaceCount,
    acceptedT5RaceCount: accepted.length,
    settledAcceptedT5RaceCount: settled.length,
    unsettledAcceptedT5RaceCount,
    distinctAcceptedDateCount: acceptedDates.length,
    distinctSettledDateCount: settledDates.length,
    earliestAcceptedDate: acceptedDates[0] ?? null,
    latestAcceptedDate: acceptedDates.at(-1) ?? null,
    integrityBlockedRaceCount: integrityBlocked.length,
    blockers,
    n2TaskId: "TASK-N2-020" as const,
    n2TaskReady: status === "READY_FOR_N2_020",
    automaticPromotionAuthorized: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    productionApplyAuthorized: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
