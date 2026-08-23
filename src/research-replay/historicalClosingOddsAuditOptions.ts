export const HISTORICAL_CLOSING_ODDS_AUDIT_MAX_LIMIT = 200;

export const HISTORICAL_CLOSING_ODDS_AUDIT_CATEGORIES = [
  "condB",
  "6R",
  "hamanako",
  "suminoe",
  "6R_bad_venue",
  "normal",
] as const;

export type HistoricalClosingOddsAuditCategory = typeof HISTORICAL_CLOSING_ODDS_AUDIT_CATEGORIES[number];

export type HistoricalClosingOddsAuditOptions = {
  limit: number;
  sleepMs: number;
  fromDate: string;
  toDate: string;
  venueFilter: string;
  raceNoFilter: number | null;
  categoryFilter: HistoricalClosingOddsAuditCategory | "";
};

function parseCanonicalInteger(raw: string, name: string): number {
  if (!/^(0|[1-9]\d*)$/u.test(raw)) {
    throw new Error(`HISTORICAL_CLOSING_ODDS_AUDIT_${name}_INVALID:${raw}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`HISTORICAL_CLOSING_ODDS_AUDIT_${name}_INVALID:${raw}`);
  }
  return value;
}

function requireCanonicalDate(value: string, name: "FROM_DATE" | "TO_DATE"): void {
  if (value === "") return;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`HISTORICAL_CLOSING_ODDS_AUDIT_${name}_INVALID:${value}`);
  }
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) {
    throw new Error(`HISTORICAL_CLOSING_ODDS_AUDIT_${name}_INVALID:${value}`);
  }
}

export function parseHistoricalClosingOddsAuditOptions(
  raw: {
    limit: string;
    sleepMs: string;
    fromDate: string;
    toDate: string;
    venueFilter: string;
    raceNoFilter: string;
    categoryFilter: string;
  },
  allowedVenues: ReadonlySet<string>,
): HistoricalClosingOddsAuditOptions {
  const limit = parseCanonicalInteger(raw.limit, "LIMIT");
  if (limit < 1 || limit > HISTORICAL_CLOSING_ODDS_AUDIT_MAX_LIMIT) {
    throw new Error(`HISTORICAL_CLOSING_ODDS_AUDIT_LIMIT_INVALID:${raw.limit}`);
  }

  const sleepMs = parseCanonicalInteger(raw.sleepMs, "SLEEP_MS");
  if (sleepMs < 1) {
    throw new Error(`HISTORICAL_CLOSING_ODDS_AUDIT_SLEEP_MS_INVALID:${raw.sleepMs}`);
  }

  requireCanonicalDate(raw.fromDate, "FROM_DATE");
  requireCanonicalDate(raw.toDate, "TO_DATE");
  if (raw.fromDate && raw.toDate && raw.fromDate > raw.toDate) {
    throw new Error("HISTORICAL_CLOSING_ODDS_AUDIT_DATE_RANGE_INVALID");
  }

  if (raw.venueFilter !== "" && !allowedVenues.has(raw.venueFilter)) {
    throw new Error(`HISTORICAL_CLOSING_ODDS_AUDIT_VENUE_INVALID:${raw.venueFilter}`);
  }

  let raceNoFilter: number | null = null;
  if (raw.raceNoFilter !== "") {
    raceNoFilter = parseCanonicalInteger(raw.raceNoFilter, "RACE_NO");
    if (raceNoFilter < 1 || raceNoFilter > 12) {
      throw new Error(`HISTORICAL_CLOSING_ODDS_AUDIT_RACE_NO_INVALID:${raw.raceNoFilter}`);
    }
  }

  const allowedCategories: ReadonlySet<string> = new Set(HISTORICAL_CLOSING_ODDS_AUDIT_CATEGORIES);
  if (raw.categoryFilter !== "" && !allowedCategories.has(raw.categoryFilter)) {
    throw new Error(`HISTORICAL_CLOSING_ODDS_AUDIT_CATEGORY_INVALID:${raw.categoryFilter}`);
  }

  return {
    limit,
    sleepMs,
    fromDate: raw.fromDate,
    toDate: raw.toDate,
    venueFilter: raw.venueFilter,
    raceNoFilter,
    categoryFilter: raw.categoryFilter as HistoricalClosingOddsAuditCategory | "",
  };
}
