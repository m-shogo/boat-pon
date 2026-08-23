import { officialVenueCode } from "../domain/officialLinks";
import { canonicalRaceKey, canonicalTrifectaSelection } from "./identity";

export type OddsBackfillTarget = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  selection: string;
};

export function parseOddsBackfillPositiveSafeInteger(
  raw: string | undefined,
  label: "LIMIT" | "SLEEP_MS",
  minimum = 1,
): number {
  if (raw == null || !/^\d+$/u.test(raw)) {
    throw new Error(`ODDS_BACKFILL_${label}_INVALID:${String(raw)}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`ODDS_BACKFILL_${label}_INVALID:${raw}`);
  }
  return value;
}

export function parseOddsBackfillDate(raw: string | undefined, label: "FROM_DATE" | "TO_DATE"): string {
  if (raw == null) throw new Error(`ODDS_BACKFILL_${label}_INVALID:${String(raw)}`);
  try {
    canonicalRaceKey(raw, "01", 1);
  } catch {
    throw new Error(`ODDS_BACKFILL_${label}_INVALID:${raw}`);
  }
  return raw;
}

export function requireOddsBackfillDateRange(from: string | null, to: string | null): void {
  if (from != null && to != null && from > to) {
    throw new Error(`ODDS_BACKFILL_DATE_RANGE_INVALID:${from}:${to}`);
  }
}

export function requireOddsBackfillTarget(target: OddsBackfillTarget): void {
  const venueCode = officialVenueCode(target.venue);
  if (!venueCode || target.venue !== target.venue.trim() || target.venue === venueCode) {
    throw new Error(`ODDS_BACKFILL_TARGET_VENUE_INVALID:${target.raceId}:${target.venue}`);
  }
  try {
    canonicalRaceKey(target.date, venueCode, target.raceNo);
  } catch {
    throw new Error(`ODDS_BACKFILL_TARGET_RACE_INVALID:${target.raceId}:${target.date}:${target.venue}:${target.raceNo}`);
  }
  let selection: string;
  try {
    selection = canonicalTrifectaSelection(target.selection);
  } catch {
    throw new Error(`ODDS_BACKFILL_TARGET_SELECTION_INVALID:${target.raceId}:${target.selection}`);
  }
  if (selection !== target.selection) {
    throw new Error(`ODDS_BACKFILL_TARGET_SELECTION_INVALID:${target.raceId}:${target.selection}`);
  }
  const expectedRaceId = `${target.date.replaceAll("-", "")}-${target.venue}-${String(target.raceNo).padStart(2, "0")}`;
  if (target.raceId !== expectedRaceId) {
    throw new Error(`ODDS_BACKFILL_TARGET_IDENTITY_INVALID:${target.raceId}:${expectedRaceId}`);
  }
}

export function requireOddsBackfillTargets(targets: readonly OddsBackfillTarget[]): void {
  for (const target of targets) requireOddsBackfillTarget(target);
}
