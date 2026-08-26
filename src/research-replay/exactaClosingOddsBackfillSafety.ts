import { officialVenueCode } from "../domain/officialLinks";
import { canonicalRaceKey } from "./identity";

export const EXACTA_BACKFILL_MAX_SLEEP_MS = 2_147_483_647;

export type ExactaClosingOddsBackfillTarget = {
  raceId: string;
  date: string;
  venue: string;
  venueCode: string;
  raceNo: number;
};

export function parseExactaBackfillPositiveSafeInteger(
  raw: string,
  label: "LIMIT" | "SLEEP_MS" | "BATCH_SIZE",
  minimum = 1,
): number {
  if (!/^\d+$/u.test(raw)) throw new Error(`EXACTA_BACKFILL_${label}_INVALID:${raw}`);
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || (label === "SLEEP_MS" && value > EXACTA_BACKFILL_MAX_SLEEP_MS)
  ) {
    throw new Error(`EXACTA_BACKFILL_${label}_INVALID:${raw}`);
  }
  return value;
}

export function parseExactaBackfillOptionalDate(raw: string, label: "FROM_DATE" | "TO_DATE"): string {
  if (raw === "") return "";
  try {
    canonicalRaceKey(raw, "01", 1);
  } catch {
    throw new Error(`EXACTA_BACKFILL_${label}_INVALID:${raw}`);
  }
  return raw;
}

export function requireExactaBackfillDateRange(from: string, to: string): void {
  if (from !== "" && to !== "" && from > to) {
    throw new Error(`EXACTA_BACKFILL_DATE_RANGE_INVALID:${from}:${to}`);
  }
}

export function requireExactaBackfillTarget(target: ExactaClosingOddsBackfillTarget): void {
  const venueCode = officialVenueCode(target.venue);
  if (!venueCode || target.venue !== target.venue.trim() || target.venue === venueCode) {
    throw new Error(`EXACTA_BACKFILL_TARGET_VENUE_INVALID:${target.raceId}:${target.venue}`);
  }
  if (target.venueCode !== venueCode) {
    throw new Error(`EXACTA_BACKFILL_TARGET_VENUE_CODE_INVALID:${target.raceId}:${target.venueCode}:${venueCode}`);
  }
  try {
    canonicalRaceKey(target.date, venueCode, target.raceNo);
  } catch {
    throw new Error(`EXACTA_BACKFILL_TARGET_RACE_INVALID:${target.raceId}:${target.date}:${target.venue}:${target.raceNo}`);
  }
  const expectedRaceId = `${target.date.replaceAll("-", "")}-${target.venue}-${String(target.raceNo).padStart(2, "0")}`;
  if (target.raceId !== expectedRaceId) {
    throw new Error(`EXACTA_BACKFILL_TARGET_IDENTITY_INVALID:${target.raceId}:${expectedRaceId}`);
  }
}

export function requireExactaBackfillTargets(targets: readonly ExactaClosingOddsBackfillTarget[]): void {
  for (const target of targets) requireExactaBackfillTarget(target);
}
