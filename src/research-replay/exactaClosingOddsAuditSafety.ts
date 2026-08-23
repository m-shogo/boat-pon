import { officialVenueCode } from "../domain/officialLinks";
import { canonicalRaceKey } from "./identity";

export type ExactaClosingOddsAuditCandidate = {
  date: string;
  venue: string;
  raceNo: number;
  quarter: string;
};

function parseCanonicalPositiveSafeInteger(raw: string, name: string): number {
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`EXACTA_CLOSING_ODDS_AUDIT_${name}_INVALID:${raw}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`EXACTA_CLOSING_ODDS_AUDIT_${name}_INVALID:${raw}`);
  }
  return value;
}

export function parseExactaClosingOddsAuditSleepMs(raw: string): number {
  return parseCanonicalPositiveSafeInteger(raw, "SLEEP_MS");
}

export function requireExactaClosingOddsAuditCandidate(candidate: ExactaClosingOddsAuditCandidate): void {
  const venueCode = officialVenueCode(candidate.venue);
  if (!venueCode) {
    throw new Error(`EXACTA_CLOSING_ODDS_AUDIT_VENUE_INVALID:${candidate.venue}`);
  }
  try {
    canonicalRaceKey(candidate.date, venueCode, candidate.raceNo);
  } catch {
    throw new Error(`EXACTA_CLOSING_ODDS_AUDIT_RACE_IDENTITY_INVALID:${candidate.date}:${candidate.venue}:${candidate.raceNo}`);
  }
  const month = Number(candidate.date.slice(5, 7));
  const expectedQuarter = `${candidate.date.slice(0, 4)}-Q${Math.ceil(month / 3)}`;
  if (candidate.quarter !== expectedQuarter) {
    throw new Error(`EXACTA_CLOSING_ODDS_AUDIT_QUARTER_INVALID:${candidate.quarter}:${expectedQuarter}`);
  }
}

export function requireExactaClosingOddsAuditCandidates(candidates: readonly ExactaClosingOddsAuditCandidate[]): void {
  for (const candidate of candidates) requireExactaClosingOddsAuditCandidate(candidate);
}
