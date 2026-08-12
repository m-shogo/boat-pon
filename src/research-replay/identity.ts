const VENUE_CODES = new Set(Array.from({ length: 24 }, (_, index) => String(index + 1).padStart(2, "0")));
const RACE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RACE_KEY_PATTERN = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/;
const TRIFECTA_PATTERN = /^([1-6])-([1-6])-([1-6])$/;

export type CanonicalRaceIdentity = {
  raceDateJst: string;
  venueCode: string;
  raceNo: number;
  canonicalRaceKey: string;
};

function isCanonicalRaceDate(value: string): boolean {
  if (!RACE_DATE_PATTERN.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function canonicalRaceKey(raceDateJst: string, venueCode: string, raceNo: number): string {
  if (!isCanonicalRaceDate(raceDateJst)) {
    throw new Error(`invalid JST race date: ${raceDateJst}`);
  }
  if (!VENUE_CODES.has(venueCode)) throw new Error(`invalid official venue code: ${venueCode}`);
  if (!Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) throw new Error(`invalid race number: ${raceNo}`);
  return `${raceDateJst}:${venueCode}:R${raceNo}`;
}

export function parseCanonicalRaceKey(value: string): CanonicalRaceIdentity {
  const match = value.match(RACE_KEY_PATTERN);
  if (!match || !isCanonicalRaceDate(match[1])) throw new Error(`invalid canonical race key: ${value}`);
  const raceNo = Number(match[3]);
  return {
    raceDateJst: match[1],
    venueCode: match[2],
    raceNo,
    canonicalRaceKey: value,
  };
}

export function canonicalTrifectaSelection(value: string): string {
  const match = value.match(TRIFECTA_PATTERN);
  if (!match || new Set(match.slice(1)).size !== 3) throw new Error(`invalid trifecta selection: ${value}`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}
