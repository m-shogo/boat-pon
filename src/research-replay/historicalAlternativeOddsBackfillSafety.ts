import { officialVenueCode } from "../domain/officialLinks";
import { canonicalRaceKey } from "./identity";

export const HISTORICAL_ALT_ODDS_PRIORITIES = ["condB", "skip6R", "skipVenue", "allForward"] as const;
export type HistoricalAltOddsPriority = (typeof HISTORICAL_ALT_ODDS_PRIORITIES)[number];

export type HistoricalAltOddsBackfillTarget = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
};

export function parseHistoricalAltOddsPositiveSafeInteger(
  raw: string,
  label: "LIMIT" | "SLEEP_MS" | "RACE_NO",
  minimum = 1,
): number {
  if (!/^\d+$/u.test(raw)) throw new Error(`HISTORICAL_ALT_ODDS_${label}_INVALID:${raw}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`HISTORICAL_ALT_ODDS_${label}_INVALID:${raw}`);
  }
  return value;
}

export function parseHistoricalAltOddsOptionalDate(raw: string, label: "FROM_DATE" | "TO_DATE"): string {
  if (raw === "") return "";
  try {
    canonicalRaceKey(raw, "01", 1);
  } catch {
    throw new Error(`HISTORICAL_ALT_ODDS_${label}_INVALID:${raw}`);
  }
  return raw;
}

export function requireHistoricalAltOddsDateRange(from: string, to: string): void {
  if (from !== "" && to !== "" && from > to) {
    throw new Error(`HISTORICAL_ALT_ODDS_DATE_RANGE_INVALID:${from}:${to}`);
  }
}

export function parseHistoricalAltOddsVenue(raw: string): string {
  if (raw === "") return "";
  const code = officialVenueCode(raw);
  if (!code || raw !== raw.trim() || raw === code) {
    throw new Error(`HISTORICAL_ALT_ODDS_VENUE_INVALID:${raw}`);
  }
  return raw;
}

export function parseHistoricalAltOddsRaceNo(raw: string): number | null {
  if (raw === "") return null;
  const raceNo = parseHistoricalAltOddsPositiveSafeInteger(raw, "RACE_NO");
  if (raceNo > 12) throw new Error(`HISTORICAL_ALT_ODDS_RACE_NO_INVALID:${raw}`);
  return raceNo;
}

export function parseHistoricalAltOddsPriority(raw: string): HistoricalAltOddsPriority {
  if (!(HISTORICAL_ALT_ODDS_PRIORITIES as readonly string[]).includes(raw)) {
    throw new Error(`HISTORICAL_ALT_ODDS_PRIORITY_INVALID:${raw}`);
  }
  return raw as HistoricalAltOddsPriority;
}

export function requireHistoricalAltOddsTarget(target: HistoricalAltOddsBackfillTarget): void {
  const venueCode = officialVenueCode(target.venue);
  if (!venueCode || target.venue !== target.venue.trim() || target.venue === venueCode) {
    throw new Error(`HISTORICAL_ALT_ODDS_TARGET_VENUE_INVALID:${target.raceId}:${target.venue}`);
  }
  try {
    canonicalRaceKey(target.date, venueCode, target.raceNo);
  } catch {
    throw new Error(`HISTORICAL_ALT_ODDS_TARGET_RACE_INVALID:${target.raceId}:${target.date}:${target.venue}:${target.raceNo}`);
  }
  const expectedRaceId = `${target.date.replaceAll("-", "")}-${target.venue}-${String(target.raceNo).padStart(2, "0")}`;
  if (target.raceId !== expectedRaceId) {
    throw new Error(`HISTORICAL_ALT_ODDS_TARGET_IDENTITY_INVALID:${target.raceId}:${expectedRaceId}`);
  }
}

export function requireHistoricalAltOddsTargets(targets: readonly HistoricalAltOddsBackfillTarget[]): void {
  const seenRaceIds = new Set<string>();
  for (const target of targets) {
    requireHistoricalAltOddsTarget(target);
    if (seenRaceIds.has(target.raceId)) {
      throw new Error(`HISTORICAL_ALT_ODDS_TARGET_DUPLICATE:${target.raceId}`);
    }
    seenRaceIds.add(target.raceId);
  }
}
