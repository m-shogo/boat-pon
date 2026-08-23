import { officialVenueCode } from "../domain/officialLinks";
import { canonicalRaceKey } from "./identity";

export type ExactaForwardMonitorRace = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
};

export function requireExactaForwardMonitorRaceIdentity(race: ExactaForwardMonitorRace): void {
  const venueCode = officialVenueCode(race.venue);
  if (!venueCode || race.venue !== race.venue.trim() || race.venue === venueCode) {
    throw new Error(`EXACTA_FORWARD_MONITOR_VENUE_INVALID:${race.raceId}:${race.venue}`);
  }
  try {
    canonicalRaceKey(race.date, venueCode, race.raceNo);
  } catch {
    throw new Error(`EXACTA_FORWARD_MONITOR_RACE_IDENTITY_INVALID:${race.raceId}:${race.date}:${race.venue}:${race.raceNo}`);
  }
  const expectedRaceId = `${race.date.replaceAll("-", "")}-${race.venue}-${String(race.raceNo).padStart(2, "0")}`;
  if (race.raceId !== expectedRaceId) {
    throw new Error(`EXACTA_FORWARD_MONITOR_RACE_IDENTITY_INVALID:${race.raceId}:${expectedRaceId}`);
  }
}

export function requireExactaForwardMonitorRaceIdentities(races: readonly ExactaForwardMonitorRace[]): void {
  for (const race of races) requireExactaForwardMonitorRaceIdentity(race);
}
