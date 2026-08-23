import { officialVenueCode } from "../domain/officialLinks";
import { canonicalRaceKey } from "./identity";

export type BeforeInfoBackfillOptions = {
  fromDate: string;
  toDate: string;
  intervalMs: number;
  limit: number | null;
};

export type BeforeInfoBackfillTarget = {
  date: string;
  venue: string;
  raceNo: number;
};

function requireCanonicalRaceDate(value: string, label: string): string {
  try {
    canonicalRaceKey(value, "01", 1);
  } catch {
    throw new Error(`BEFOREINFO_BACKFILL_${label}_INVALID:${value}`);
  }
  return value;
}

function parseNonNegativeSafeInteger(raw: string, label: string): number {
  if (!/^\d+$/u.test(raw)) throw new Error(`BEFOREINFO_BACKFILL_${label}_INVALID:${raw}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`BEFOREINFO_BACKFILL_${label}_INVALID:${raw}`);
  return value;
}

function parsePositiveSafeInteger(raw: string, label: string): number {
  const value = parseNonNegativeSafeInteger(raw, label);
  if (value === 0) throw new Error(`BEFOREINFO_BACKFILL_${label}_INVALID:${raw}`);
  return value;
}

export function parseBeforeInfoBackfillOptions(input: {
  fromDate: string;
  toDate: string;
  intervalMsRaw?: string | null;
  limitRaw?: string | null;
}): BeforeInfoBackfillOptions {
  const fromDate = requireCanonicalRaceDate(input.fromDate, "FROM_DATE");
  const toDate = requireCanonicalRaceDate(input.toDate, "TO_DATE");
  if (fromDate > toDate) throw new Error(`BEFOREINFO_BACKFILL_DATE_RANGE_INVALID:${fromDate}:${toDate}`);

  const intervalMs = input.intervalMsRaw == null
    ? 15_000
    : parsePositiveSafeInteger(input.intervalMsRaw, "INTERVAL_MS");
  const limit = input.limitRaw == null
    ? null
    : parseNonNegativeSafeInteger(input.limitRaw, "LIMIT");

  return { fromDate, toDate, intervalMs, limit };
}

export function requireBeforeInfoBackfillTarget(target: BeforeInfoBackfillTarget): void {
  const venueCode = officialVenueCode(target.venue);
  if (!venueCode || target.venue !== target.venue.trim() || target.venue === venueCode) {
    throw new Error(`BEFOREINFO_BACKFILL_TARGET_VENUE_INVALID:${target.date}:${target.venue}:${target.raceNo}`);
  }
  try {
    canonicalRaceKey(target.date, venueCode, target.raceNo);
  } catch {
    throw new Error(`BEFOREINFO_BACKFILL_TARGET_RACE_INVALID:${target.date}:${target.venue}:${target.raceNo}`);
  }
}

export function requireBeforeInfoBackfillTargets(targets: readonly BeforeInfoBackfillTarget[]): void {
  for (const target of targets) requireBeforeInfoBackfillTarget(target);
}
